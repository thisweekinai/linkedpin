let selectedPostElement = null;
let hoveredPostElement = null;
const POST_SELECTOR = "div.feed-shared-update-v2";
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
  return startNode.closest(POST_SELECTOR);
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

function getVisiblePostCandidates() {
  const allPosts = Array.from(document.querySelectorAll(POST_SELECTOR));
  return allPosts.filter((post) => {
    const rect = post.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 80 && rect.top < window.innerHeight - 20;
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

  const permalinkEl = postElement.querySelector('a[href*="/feed/update/"]');

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
  "mousemove",
  (event) => {
    const post = findPostElement(event.target);
    if (post) {
      hoveredPostElement = post;
    }
  },
  { capture: true, passive: true }
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
