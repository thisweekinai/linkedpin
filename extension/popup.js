const saveBtn = document.getElementById("saveBtn");
const saveDocIdBtn = document.getElementById("saveDocIdBtn");
const toggleSettingsBtn = document.getElementById("toggleSettingsBtn");
const settingsSection = document.getElementById("settingsSection");
const docIdInput = document.getElementById("docIdInput");
const docHint = document.getElementById("docHint");
const statusEl = document.getElementById("status");
const STORAGE_KEYS = {
  DOC_ID: "googleDocId"
};
const STATUS_COLORS = {
  success: "#065f46",
  error: "#b91c1c"
};
const MESSAGE_TYPES = {
  getSelectedPost: "GET_SELECTED_POST",
  savePost: "SAVE_POST"
};

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? STATUS_COLORS.error : STATUS_COLORS.success;
}

function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, resolve);
  });
}

function setStorage(values) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(values, resolve);
  });
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
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

async function getPostFromTab(tabId) {
  try {
    return await sendTabMessage(tabId, { type: MESSAGE_TYPES.getSelectedPost });
  } catch (error) {
    const message = error?.message || "";
    if (!message.includes("Receiving end does not exist")) {
      throw error;
    }

    await injectContentScript(tabId);
    return sendTabMessage(tabId, { type: MESSAGE_TYPES.getSelectedPost });
  }
}

function maskDocId(docId) {
  if (!docId || docId.length < 8) {
    return docId || "Not configured";
  }
  return `${docId.slice(0, 4)}...${docId.slice(-4)}`;
}

function updateSettingsVisibility() {
  const isHidden = settingsSection.classList.contains("hidden");
  toggleSettingsBtn.textContent = isHidden ? "Show Settings" : "Hide Settings";
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function loadDocId() {
  const { [STORAGE_KEYS.DOC_ID]: googleDocId = "" } = await getStorage([STORAGE_KEYS.DOC_ID]);
  docIdInput.value = googleDocId;
  docHint.textContent = `Current Doc: ${maskDocId(googleDocId)}`;
}

toggleSettingsBtn.addEventListener("click", () => {
  settingsSection.classList.toggle("hidden");
  updateSettingsVisibility();
});

saveDocIdBtn.addEventListener("click", async () => {
  const docId = docIdInput.value.trim();
  if (!docId) {
    setStatus("Enter a valid Google Doc ID.", true);
    return;
  }

  await setStorage({ [STORAGE_KEYS.DOC_ID]: docId });
  docHint.textContent = `Current Doc: ${maskDocId(docId)}`;
  setStatus("Google Doc ID saved.");
});

saveBtn.addEventListener("click", async () => {
  setStatus("Reading post from LinkedIn...");

  try {
    const { [STORAGE_KEYS.DOC_ID]: googleDocId = "" } = await getStorage([STORAGE_KEYS.DOC_ID]);
    if (!googleDocId) {
      setStatus("Save your Google Doc ID first from Settings.", true);
      settingsSection.classList.remove("hidden");
      updateSettingsVisibility();
      return;
    }

    const tab = await getActiveTab();

    if (!tab?.id || !tab.url?.includes("linkedin.com")) {
      setStatus("Open a LinkedIn feed tab first.", true);
      return;
    }

    const response = await getPostFromTab(tab.id);

    if (!response?.ok) {
      setStatus(response?.error || "Unable to read a post from the page.", true);
      return;
    }

    setStatus("Saving to Google Docs...");

    const saveResult = await sendRuntimeMessage({
      type: MESSAGE_TYPES.savePost,
      payload: response.payload,
      docId: googleDocId
    });

    if (!saveResult?.ok) {
      setStatus(saveResult?.error || "Failed to save post.", true);
      return;
    }

    setStatus(`Saved as Post #${saveResult.postNumber}`);
  } catch (error) {
    setStatus(error?.message || "Unexpected error", true);
  }
});

updateSettingsVisibility();
loadDocId();
