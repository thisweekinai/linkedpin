let writeQueue = Promise.resolve();
const DOCS_API_BASE = "https://docs.googleapis.com/v1/documents";
const MESSAGE_TYPE_SAVE_POST = "SAVE_POST";
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
    return await appendPost(token, docId, payload);
  } catch (error) {
    const message = error?.message || "";
    if (!message.includes("401")) {
      throw error;
    }

    await removeCachedToken(token);
    const refreshedToken = await getAuthToken(true);
    return appendPost(refreshedToken, docId, payload);
  }
}

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
