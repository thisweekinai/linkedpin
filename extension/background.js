let writeQueue = Promise.resolve();
const DOCS_API_BASE = "https://docs.googleapis.com/v1/documents";
const MESSAGE_TYPE_SAVE_POST = "SAVE_POST";
const MESSAGE_TYPE_SHOW_SAVE_STATUS = "SHOW_SAVE_STATUS";
const CONTEXT_MENU_ID_SAVE_SELECTION = "linkedpin-save-selection";
const STORAGE_KEYS = {
  DOC_ID: "googleDocId"
};
const SAVED_POST_TITLE_REGEX = /^Saved Post #\d+$/i;

async function fetchJson(url, options, errorPrefix) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${errorPrefix}: ${response.status} ${errorText}`);
  }
  return response.json();
}

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!token) {
        reject(new Error("No auth token received from Google."));
        return;
      }

      resolve(token);
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, resolve);
  });
}

function sendTabMessage(tabId, message, frameId) {
  return new Promise((resolve, reject) => {
    const options = typeof frameId === "number" && frameId >= 0 ? { frameId } : undefined;
    chrome.tabs.sendMessage(tabId, message, options, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function injectContentScript(tabId, frameId) {
  return new Promise((resolve, reject) => {
    const target = typeof frameId === "number" && frameId >= 0 ? { tabId, frameIds: [frameId] } : { tabId };
    chrome.scripting.executeScript(
      {
        target,
        files: ["content.js"]
      },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

function executeInTab(tabId, func, args = [], frameId) {
  return new Promise((resolve, reject) => {
    const target = typeof frameId === "number" && frameId >= 0 ? { tabId, frameIds: [frameId] } : { tabId };
    chrome.scripting.executeScript(
      {
        target,
        func,
        args
      },
      (results) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(results?.[0]?.result);
      }
    );
  });
}

async function extractPostFromSelectionViaScript(tabId, selectionText, frameId) {
  return executeInTab(
    tabId,
    (selectionTextArg) => {
      const POST_SELECTOR = [
        "div.feed-shared-update-v2",
        "div.occludable-update",
        "div[data-urn*='urn:li:activity:']",
        "article[data-urn*='urn:li:activity:']",
        "div[data-id*='urn:li:activity:']",
        "article[data-id*='urn:li:activity:']",
        "li.feed-shared-update-v2",
        "div.feed-shared-update-v2__description-wrapper"
      ].join(", ");
      const AUTHOR_SELECTORS = [
        '.update-components-actor__name span[aria-hidden="true"]',
        ".update-components-actor__name",
        "a.app-aware-link .visually-hidden"
      ];
      const CONTENT_SELECTORS = [
        "div.update-components-text",
        "div.feed-shared-inline-show-more-text",
        "span.break-words",
        "div.feed-shared-text",
        "div.update-components-update-v2__commentary",
        "[data-test-id='main-feed-activity-card__commentary']",
        "div[dir='ltr']",
        "span[dir='ltr']"
      ];
      const BLOCK_TEXT_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre";

      function normalizeInlineText(input) {
        return (input || "").replace(/\s+/g, " ").trim();
      }

      function normalizeForMatch(input) {
        return normalizeInlineText(input)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      function normalizeMultilineText(input) {
        return (input || "")
          .replace(/\r\n/g, "\n")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }

      function extractStructuredPostText(postElement) {
        const containerCandidates = CONTENT_SELECTORS.map((selector) => postElement.querySelector(selector)).filter(
          Boolean
        );

        for (const container of containerCandidates) {
          const blockNodes = Array.from(container.querySelectorAll(BLOCK_TEXT_SELECTOR));
          if (blockNodes.length > 0) {
            const lines = blockNodes
              .map((node) => normalizeMultilineText(node.innerText || node.textContent || ""))
              .filter(Boolean);
            const text = normalizeMultilineText(lines.join("\n"));
            if (text) {
              return text;
            }
          }

          const inlineText = normalizeMultilineText(container.innerText || container.textContent || "");
          if (inlineText) {
            return inlineText;
          }
        }

        const broadTextNodes = Array.from(
          postElement.querySelectorAll("p, span, div[dir='ltr'], span[dir='ltr'], li, blockquote")
        );
        const lines = broadTextNodes
          .map((node) => normalizeMultilineText(node.innerText || node.textContent || ""))
          .filter((line) => line && line.length > 1);
        const joinedBroad = normalizeMultilineText(lines.join("\n"));
        if (joinedBroad) {
          return joinedBroad;
        }

        const raw = normalizeMultilineText(postElement.innerText || postElement.textContent || "");
        if (!raw) {
          return "";
        }

        // Last-resort cleanup to remove common UI noise while preserving content.
        const cleaned = raw
          .split("\n")
          .map((line) => normalizeInlineText(line))
          .filter(Boolean)
          .filter(
            (line) =>
              !/^(like|comment|repost|send|follow|more|see more|show more|copy link)$/i.test(line) &&
              !/^\d+\s*(likes?|comments?)$/i.test(line)
          )
          .join("\n");

        return normalizeMultilineText(cleaned);
      }

      function ensureSelectedTextCoverage(postElement, extractedText, selectedNorm) {
        const extracted = normalizeMultilineText(extractedText || "");
        const extractedNorm = normalizeForMatch(extracted);
        if (!selectedNorm || extractedNorm.includes(selectedNorm)) {
          return { ok: true, text: extracted };
        }

        const fullRaw = normalizeMultilineText(postElement.innerText || postElement.textContent || "");
        const fullRawNorm = normalizeForMatch(fullRaw);
        if (fullRaw && fullRawNorm.includes(selectedNorm)) {
          return { ok: true, text: fullRaw };
        }

        return { ok: false, text: extracted };
      }

      function getVisibleCandidates() {
        const raw = Array.from(document.querySelectorAll(POST_SELECTOR));
        const deduped = [];
        const seen = new Set();
        for (const node of raw) {
          if (!node || seen.has(node)) {
            continue;
          }
          seen.add(node);
          deduped.push(node);
        }

        return deduped.filter((post) => {
          const rect = post.getBoundingClientRect();
          const text = normalizeInlineText(post.innerText || post.textContent || "");
          const area = rect.width * rect.height;
          return (
            rect.width > 0 &&
            rect.height > 100 &&
            rect.height < window.innerHeight * 1.8 &&
            area < window.innerWidth * window.innerHeight * 2.2 &&
            rect.bottom > 80 &&
            rect.top < window.innerHeight - 20 &&
            text.length > 40 &&
            text.length < 8000
          );
        });
      }

      function getSelectionAncestorCandidates() {
        const selection = window.getSelection?.();
        if (!selection || selection.rangeCount === 0) {
          return [];
        }
        const range = selection.getRangeAt(0);
        let node = range.commonAncestorContainer;
        if (node && node.nodeType !== Node.ELEMENT_NODE) {
          node = node.parentElement;
        }
        const candidates = [];
        let current = node;
        let depth = 0;
        while (current && current !== document.body && depth < 10) {
          if (current instanceof Element) {
            const rect = current.getBoundingClientRect();
            const text = normalizeInlineText(current.innerText || current.textContent || "");
            if (rect.width > 0 && rect.height > 80 && text.length > 40) {
              candidates.push(current);
            }
          }
          current = current.parentElement;
          depth += 1;
        }
        return candidates;
      }

      function getElementFromNode(node) {
        if (!node) {
          return null;
        }
        if (node instanceof Element) {
          return node;
        }
        return node.parentElement || null;
      }

      function findPostElement(startNode) {
        if (!(startNode instanceof Element)) {
          return null;
        }
        return startNode.closest(POST_SELECTOR) || startNode.closest("[data-urn*='urn:li:activity:']");
      }

      function scoreCandidate(postElement, selectedNorm, selectedTokens) {
        const text = normalizeInlineText(postElement.innerText || postElement.textContent || "");
        const textNorm = normalizeForMatch(text);
        const rect = postElement.getBoundingClientRect();
        const hasAuthor = AUTHOR_SELECTORS.some((selector) => Boolean(postElement.querySelector(selector)));
        const hasContent = CONTENT_SELECTORS.some((selector) => Boolean(postElement.querySelector(selector)));
        const hasPermalink = Boolean(
          postElement.querySelector('a[href*="/feed/update/"]') ||
            postElement.querySelector('a[href*="/posts/"]')
        );
        let score = 0;
        if (hasAuthor) score += 4;
        if (hasContent) score += 4;
        if (hasPermalink) score += 3;
        if (selectedNorm && textNorm.includes(selectedNorm)) score += 8;
        if (selectedTokens.length > 0) {
          let overlap = 0;
          for (const token of selectedTokens) {
            if (token.length < 3) {
              continue;
            }
            if (textNorm.includes(token)) {
              overlap += 1;
            }
          }
          const overlapRatio = overlap / selectedTokens.length;
          if (overlapRatio > 0.2) score += 3;
          if (overlapRatio > 0.45) score += 3;
        }
        if (rect.height > window.innerHeight * 1.2) {
          score -= 3;
        }
        if (text.length > 5000) {
          score -= 4;
        }
        return score;
      }

      function pickBest(candidates, selectedNorm, selectedTokens) {
        let best = null;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (const candidate of candidates) {
          const score = scoreCandidate(candidate, selectedNorm, selectedTokens);
          if (score > bestScore) {
            bestScore = score;
            best = candidate;
          }
        }
        return best;
      }

      const selectedNorm = normalizeForMatch(selectionTextArg || "");
      const selectedTokens = selectedNorm ? selectedNorm.split(" ").filter(Boolean).slice(0, 40) : [];
      const candidates = [...getVisibleCandidates(), ...getSelectionAncestorCandidates()];
      if (candidates.length === 0) {
        return { ok: false, error: "No visible LinkedIn post candidates found on screen." };
      }

      const selection = window.getSelection?.();
      let post = null;
      let reason = "NONE";
      if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
        const anchor = getElementFromNode(selection.anchorNode);
        const focus = getElementFromNode(selection.focusNode);
        post = findPostElement(anchor) || findPostElement(focus);
        if (post) {
          reason = "ACTIVE_SELECTION_ANCESTRY";
        }
      }

      if (!post && selectedNorm) {
        const matches = candidates.filter((candidate) => {
          const text = normalizeForMatch(candidate.innerText || candidate.textContent || "");
          return text.includes(selectedNorm);
        });
        if (matches.length > 0) {
          post = pickBest(matches, selectedNorm, selectedTokens);
          reason = "SELECTION_TEXT_MATCH";
        }
      }

      if (!post && selectedTokens.length > 0) {
        const fuzzyMatches = candidates.filter((candidate) => {
          const text = normalizeForMatch(candidate.innerText || candidate.textContent || "");
          let overlap = 0;
          for (const token of selectedTokens) {
            if (token.length < 3) {
              continue;
            }
            if (text.includes(token)) {
              overlap += 1;
            }
          }
          const overlapRatio = overlap / selectedTokens.length;
          return overlapRatio >= 0.55;
        });
        if (fuzzyMatches.length > 0) {
          post = pickBest(fuzzyMatches, selectedNorm, selectedTokens);
          reason = "SELECTION_FUZZY_MATCH";
        }
      }

      if (!post) {
        return { ok: false, error: "Unable to identify the exact post from selected text." };
      }

      const authorEl = AUTHOR_SELECTORS.map((selector) => post.querySelector(selector)).find(Boolean);
      const permalinkEl =
        post.querySelector('a[href*="/feed/update/"]') ||
        post.querySelector('a[href*="/posts/"]') ||
        post.querySelector("a.app-aware-link[href*='linkedin.com']");
      const postText = extractStructuredPostText(post);
      if (!postText) {
        return { ok: false, error: `Post identified (${reason}) but content text extraction failed.` };
      }

      const covered = ensureSelectedTextCoverage(post, postText, selectedNorm);
      if (!covered.ok) {
        return {
          ok: false,
          error: "Resolved post content does not include selected text; refusing broad save to avoid wrong post."
        };
      }

      return {
        ok: true,
        reason,
        payload: {
          author: normalizeInlineText(authorEl?.textContent) || "Unknown author",
          postText: covered.text,
          postUrl: permalinkEl?.href || window.location.href,
          capturedAt: new Date().toISOString()
        }
      };
    },
    [selectionText],
    frameId
  );
}

async function notifyTabSaveStatus(tabId, text, isError = false, frameId) {
  if (!tabId) {
    return;
  }

  try {
    await sendTabMessage(tabId, { type: MESSAGE_TYPE_SHOW_SAVE_STATUS, text, isError }, frameId);
  } catch (error) {
    const message = error?.message || "";
    if (!message.includes("Receiving end does not exist")) {
      return;
    }
    try {
      await injectContentScript(tabId, frameId);
      await sendTabMessage(tabId, { type: MESSAGE_TYPE_SHOW_SAVE_STATUS, text, isError }, frameId);
    } catch (_ignored) {
      // Best-effort UI notification; no-op if tab can't receive messages.
    }
  }
}

async function fetchDoc(accessToken, docId) {
  return fetchJson(
    `${DOCS_API_BASE}/${encodeURIComponent(docId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    "Failed to fetch doc"
  );
}

function getEndIndex(documentData) {
  const content = documentData?.body?.content;
  if (!Array.isArray(content) || content.length === 0) {
    return 1;
  }

  const last = content[content.length - 1];
  if (typeof last?.endIndex !== "number") {
    return 1;
  }

  return Math.max(1, last.endIndex - 1);
}

function countSavedPosts(documentData) {
  const content = documentData?.body?.content || [];
  let count = 0;

  for (const element of content) {
    const paragraph = element?.paragraph;
    if (!paragraph?.elements) {
      continue;
    }

    const text = paragraph.elements
      .map((item) => item?.textRun?.content || "")
      .join("")
      .trim();

    if (SAVED_POST_TITLE_REGEX.test(text)) {
      count += 1;
    }
  }

  return count;
}

function normalizeInlineText(input) {
  return (input || "").replace(/\s+/g, " ").trim();
}

function mergeSelectionExcerptIntoPayload(payload, selectionText) {
  const selected = normalizeInlineText(selectionText || "");
  if (!selected) {
    return payload;
  }

  const postText = payload?.postText || "";
  const postTextNorm = normalizeInlineText(postText).toLowerCase();
  const selectedNorm = selected.toLowerCase();
  if (postTextNorm.includes(selectedNorm)) {
    return payload;
  }

  return {
    ...payload,
    postText: [`Selected Excerpt: ${selected}`, "", postText || "(No text content found)"].join("\n")
  };
}

function maskDocId(docId) {
  if (typeof docId !== "string" || docId.length < 8) {
    return docId || "unknown";
  }
  return `${docId.slice(0, 4)}...${docId.slice(-4)}`;
}

async function appendPost(accessToken, docId, payload) {
  const documentData = await fetchDoc(accessToken, docId);
  const endIndex = getEndIndex(documentData);
  const nextNumber = countSavedPosts(documentData) + 1;

  const author = payload?.author?.trim() || "Unknown author";
  const postText = payload?.postText?.trim() || "(No text content found)";
  const postUrl = payload?.postUrl?.trim() || "(not available)";
  const capturedAt = payload?.capturedAt || new Date().toISOString();

  const title = `Saved Post #${nextNumber}`;
  const section = [
    title,
    `Captured At: ${capturedAt}`,
    `Author: ${author}`,
    `Post URL: ${postUrl}`,
    "",
    "Content:",
    postText,
    "",
    "----------------------------------------",
    ""
  ].join("\n");

  await fetchJson(
    `${DOCS_API_BASE}/${encodeURIComponent(docId)}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        requests: [
          {
            insertText: {
              location: { index: endIndex },
              text: `\n${section}`
            }
          },
          {
            updateParagraphStyle: {
              range: {
                startIndex: endIndex + 1,
                endIndex: endIndex + title.length + 1
              },
              paragraphStyle: {
                namedStyleType: "HEADING_2"
              },
              fields: "namedStyleType"
            }
          }
        ]
      })
    },
    "Failed to update doc"
  );

  return { postNumber: nextNumber };
}

async function appendPostWithRetry(docId, payload) {
  let token;
  try {
    token = await getAuthToken(false);
  } catch (_error) {
    token = await getAuthToken(true);
  }

  try {
    const result = await appendPost(token, docId, payload);
    return { ...result, docId };
  } catch (error) {
    const message = error?.message || "";
    if (!message.includes("401")) {
      throw error;
    }

    await removeCachedToken(token);
    const refreshedToken = await getAuthToken(true);
    const result = await appendPost(refreshedToken, docId, payload);
    return { ...result, docId };
  }
}

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID_SAVE_SELECTION,
      title: "Save selected post to Google Docs",
      contexts: ["selection"],
      documentUrlPatterns: ["https://www.linkedin.com/*"]
    });
  });
}

async function saveSelectedPostFromContextMenu(info, tab) {
  if (!tab?.id) {
    return;
  }
  const frameId = typeof info?.frameId === "number" ? info.frameId : undefined;
  const selectedText = info?.selectionText || "";

  const { [STORAGE_KEYS.DOC_ID]: docId = "" } = await getStorage([STORAGE_KEYS.DOC_ID]);
  if (!docId) {
    throw new Error("Google Doc ID is missing. Set it from extension popup settings.");
  }

  const directResult = await extractPostFromSelectionViaScript(tab.id, selectedText, frameId);
  if (directResult?.ok && directResult.payload) {
    const mergedPayload = mergeSelectionExcerptIntoPayload(directResult.payload, selectedText);
    return appendPostWithRetry(docId, mergedPayload);
  }

  throw new Error(directResult?.error || "Could not map selected text to an exact post.");
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID_SAVE_SELECTION) {
    return;
  }

  writeQueue = writeQueue
    .then(() => saveSelectedPostFromContextMenu(info, tab))
    .then((result) => {
      return notifyTabSaveStatus(
        tab?.id,
        `Saved to Google Docs (${maskDocId(result?.docId)}) as Post #${result?.postNumber ?? "?"}`,
        false,
        info?.frameId
      );
    })
    .catch((error) => {
      const errorMessage = error?.message || "Failed to save post to Google Docs.";
      console.error("LinkedPin context-menu save failed:", errorMessage);
      return notifyTabSaveStatus(tab?.id, `LinkedPin save failed: ${errorMessage}`, true, info?.frameId);
    });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== MESSAGE_TYPE_SAVE_POST) {
    return;
  }

  const payload = message.payload;
  const docId = message.docId;

  if (!docId || typeof docId !== "string") {
    sendResponse({ ok: false, error: "Google Doc ID is missing." });
    return;
  }

  writeQueue = writeQueue
    .then(() => appendPostWithRetry(docId, payload))
    .then((result) => {
      sendResponse({ ok: true, ...result });
    })
    .catch((error) => {
      const messageText = error?.message || "Failed to save post to Google Docs.";
      sendResponse({ ok: false, error: messageText });
    });

  return true;
});
