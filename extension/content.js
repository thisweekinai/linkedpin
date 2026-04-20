let selectedPostElement = null;
let hoveredPostElement = null;
let selectionAnchoredPostElement = null;
let contextMenuPostElement = null;
const POST_SELECTORS = [
  "div.feed-shared-update-v2",
  "div[data-urn*='urn:li:activity:']",
  "article[data-urn*='urn:li:activity:']",
  "div.feed-shared-update-v2__description-wrapper"
];
const POST_SELECTOR = POST_SELECTORS.join(", ");
const AUTHOR_SELECTORS = [
  '.update-components-actor__name span[aria-hidden="true"]',
  ".update-components-actor__name",
  "a.app-aware-link .visually-hidden"
];
const CONTENT_SELECTORS = [
  "div.update-components-text",
  "div.feed-shared-inline-show-more-text",
  "span.break-words"
];
const BLOCK_TEXT_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre";

function findPostElement(startNode) {
  if (!(startNode instanceof Element)) {
    return null;
  }
  const matchingAncestors = [];
  let current = startNode;
  while (current && current !== document.body) {
    if (current.matches?.(POST_SELECTOR)) {
      matchingAncestors.push(current);
    }
    if (current.matches?.("[data-urn*='urn:li:activity:']")) {
      matchingAncestors.push(current);
    }
    current = current.parentElement;
  }

  if (matchingAncestors.length === 0) {
    return null;
  }

  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of matchingAncestors) {
    const score = scoreCandidatePost(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function getElementFromNode(node) {
  if (!node) {
    return null;
  }
  if (node instanceof Element) {
    return node;
  }
  if (node.parentElement) {
    return node.parentElement;
  }
  return null;
}

function getSelectionAnchoredPost() {
  const resolved = resolvePostFromSelectionDetailed();
  return resolved.post;
}

function getSelectionRectCenter() {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return null;
  }
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    range
  };
}

function resolvePostFromSelectionDetailed() {
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return { post: null, reason: "NO_SELECTION" };
  }

  const anchorElement = getElementFromNode(selection.anchorNode);
  const focusElement = getElementFromNode(selection.focusNode);
  const range = selection.getRangeAt(0);
  const rangeAncestor = getElementFromNode(range.commonAncestorContainer);
  const pathCandidates = [
    findPostElement(anchorElement),
    findPostElement(focusElement),
    findPostElement(rangeAncestor)
  ].filter(Boolean);

  if (pathCandidates.length > 0) {
    const best = pickBestCandidate(pathCandidates);
    return { post: best, reason: "SELECTION_ANCESTRY_MATCH" };
  }

  const rectPick = getPostClosestToSelectionRect(range);
  if (rectPick) {
    return { post: rectPick, reason: "SELECTION_RECT_MATCH" };
  }

  const pointPick = getPostFromElementsAtSelectionCenter();
  if (pointPick) {
    return { post: pointPick, reason: "ELEMENTS_FROM_POINT_MATCH" };
  }

  return { post: null, reason: "NO_POST_CONTAINER_FROM_SELECTION" };
}

function pickBestCandidate(candidates) {
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = scoreCandidatePost(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function getPostFromElementsAtSelectionCenter() {
  const center = getSelectionRectCenter();
  if (!center) {
    return null;
  }

  const elements = document.elementsFromPoint(center.x, center.y);
  const candidates = elements.map((el) => findPostElement(el)).filter(Boolean);
  if (candidates.length === 0) {
    return null;
  }
  return pickBestCandidate(candidates);
}

function getPostClosestToSelectionRect(range) {
  if (!range) {
    return null;
  }

  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return null;
  }

  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const candidates = getVisiblePostCandidates();
  if (candidates.length === 0) {
    return null;
  }

  let bestPost = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const post of candidates) {
    const postRect = post.getBoundingClientRect();
    const postCenterX = postRect.left + postRect.width / 2;
    const postCenterY = postRect.top + postRect.height / 2;
    const dx = postCenterX - centerX;
    const dy = postCenterY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestPost = post;
    }
  }

  return bestPost ? pickBestCandidate([bestPost]) : null;
}

function normalizeInlineText(input) {
  return (input || "").replace(/\s+/g, " ").trim();
}

function normalizeMultilineText(input) {
  return (input || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractStructuredPostText(postElement) {
  const container = CONTENT_SELECTORS.map((selector) => postElement.querySelector(selector)).find(Boolean);

  if (!container) {
    return "";
  }

  const blockNodes = Array.from(container.querySelectorAll(BLOCK_TEXT_SELECTOR));
  if (blockNodes.length > 0) {
    const lines = blockNodes
      .map((node) => normalizeMultilineText(node.innerText || node.textContent || ""))
      .filter(Boolean);
    return normalizeMultilineText(lines.join("\n"));
  }

  return normalizeMultilineText(container.innerText || container.textContent || "");
}

function scoreCandidatePost(postElement) {
  if (!(postElement instanceof Element)) {
    return Number.NEGATIVE_INFINITY;
  }

  const rect = postElement.getBoundingClientRect();
  const text = normalizeInlineText(postElement.innerText || postElement.textContent || "");
  const hasAuthor = AUTHOR_SELECTORS.some((selector) => Boolean(postElement.querySelector(selector)));
  const hasContent = CONTENT_SELECTORS.some((selector) => Boolean(postElement.querySelector(selector)));
  const hasPermalink = Boolean(
    postElement.querySelector('a[href*="/feed/update/"]') ||
      postElement.querySelector('a[href*="/posts/"]')
  );
  const hasActivityUrn = Boolean(postElement.closest("[data-urn*='urn:li:activity:']"));

  let score = 0;
  if (hasAuthor) {
    score += 4;
  }
  if (hasContent) {
    score += 4;
  }
  if (hasPermalink) {
    score += 3;
  }
  if (hasActivityUrn) {
    score += 2;
  }
  if (rect.height > 120) {
    score += 2;
  }
  if (rect.height > 250) {
    score += 1;
  }
  if (text.length > 60) {
    score += 2;
  }
  if (text.length > 200) {
    score += 1;
  }

  return score;
}

function getVisiblePostCandidates() {
  const allPosts = Array.from(document.querySelectorAll(POST_SELECTOR));
  return allPosts.filter((post) => {
    const rect = post.getBoundingClientRect();
    const text = normalizeInlineText(post.innerText || post.textContent || "");
    return (
      rect.width > 0 &&
      rect.height > 100 &&
      rect.bottom > 80 &&
      rect.top < window.innerHeight - 20 &&
      text.length > 40
    );
  });
}

function getPostClosestToViewportCenter(posts) {
  const viewportCenterY = window.innerHeight / 2;
  let bestPost = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const post of posts) {
    const rect = post.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(centerY - viewportCenterY);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestPost = post;
    }
  }

  return bestPost;
}

function resolvePostElement() {
  const postFromSelection = getSelectionAnchoredPost();
  if (postFromSelection) {
    return postFromSelection;
  }

  if (contextMenuPostElement?.isConnected) {
    return contextMenuPostElement;
  }

  if (selectionAnchoredPostElement?.isConnected) {
    return selectionAnchoredPostElement;
  }

  if (selectedPostElement?.isConnected) {
    return selectedPostElement;
  }

  if (hoveredPostElement?.isConnected) {
    return hoveredPostElement;
  }

  const candidates = getVisiblePostCandidates();
  if (candidates.length === 0) {
    return null;
  }

  return getPostClosestToViewportCenter(candidates);
}

function extractPostPayload(postElement) {
  const authorEl = AUTHOR_SELECTORS.map((selector) => postElement.querySelector(selector)).find(Boolean);

  const permalinkEl =
    postElement.querySelector('a[href*="/feed/update/"]') ||
    postElement.querySelector('a[href*="/posts/"]') ||
    postElement.querySelector("a.app-aware-link[href*='linkedin.com']");

  const author = normalizeInlineText(authorEl?.textContent) || "Unknown author";
  const postText = extractStructuredPostText(postElement);
  const postUrl = permalinkEl?.href || window.location.href;

  return {
    author,
    postText,
    postUrl,
    capturedAt: new Date().toISOString()
  };
}

document.addEventListener(
  "click",
  (event) => {
    const post = findPostElement(event.target);
    if (post) {
      selectedPostElement = post;
    }
  },
  true
);

document.addEventListener(
  "selectionchange",
  () => {
    const resolved = resolvePostFromSelectionDetailed();
    const post = resolved.post;
    if (post) {
      selectionAnchoredPostElement = post;
    }
  },
  true
);

document.addEventListener(
  "mouseup",
  () => {
    const resolved = resolvePostFromSelectionDetailed();
    const post = resolved.post;
    if (post) {
      selectionAnchoredPostElement = post;
    }
  },
  true
);

document.addEventListener(
  "contextmenu",
  (event) => {
    const postFromTarget = findPostElement(event.target);
    const resolvedSelection = resolvePostFromSelectionDetailed();
    const postFromSelection = resolvedSelection.post;
    contextMenuPostElement = postFromTarget || postFromSelection || contextMenuPostElement;
  },
  true
);

document.addEventListener(
  "mousemove",
  (event) => {
    const post = findPostElement(event.target);
    if (post) {
      hoveredPostElement = post;
    }
  },
  { capture: true, passive: true }
);

function showSaveStatusToast(messageText, isError = false) {
  const existing = document.getElementById("linkedpin-save-toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.id = "linkedpin-save-toast";
  toast.textContent = messageText;
  toast.style.position = "fixed";
  toast.style.right = "16px";
  toast.style.bottom = "16px";
  toast.style.zIndex = "2147483647";
  toast.style.maxWidth = "360px";
  toast.style.padding = "10px 12px";
  toast.style.borderRadius = "10px";
  toast.style.fontSize = "13px";
  toast.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  toast.style.color = "#ffffff";
  toast.style.background = isError ? "#b91c1c" : "#065f46";
  toast.style.boxShadow = "0 8px 20px rgba(0,0,0,0.25)";
  toast.style.lineHeight = "1.4";
  document.body.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 4000);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SHOW_SAVE_STATUS") {
    showSaveStatusToast(message.text || "LinkedPin update", Boolean(message.isError));
    sendResponse({ ok: true });
    return;
  }

  if (message?.type !== "GET_SELECTED_POST") {
    return;
  }

  const postElement = resolvePostElement();
  if (!postElement) {
    sendResponse({ ok: false, error: "No LinkedIn post found on screen. Scroll to a visible post and try again." });
    return;
  }

  const payload = extractPostPayload(postElement);
  if (!payload.postText) {
    sendResponse({ ok: false, error: "Post detected, but text extraction failed. Try a different post format." });
    return;
  }

  sendResponse({ ok: true, payload });
});
