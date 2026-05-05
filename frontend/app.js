const BACKEND_URL = "http://127.0.0.1:8000";

const firebaseConfig = {
  apiKey: "yourapikey",
  authDomain: "yourauthdomain.firebaseapp.com",
  projectId: "yourappid",
  storageBucket: "yourstoragebucket.firebasestorage.app",
  messagingSenderId: "yourmessagingsenderid",
  appId: "yourappid",
  measurementId: "yourmeasurementid"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();


if (firebase && firebase.auth && firebase.auth.Auth) {
  try {
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
  } catch (e) {
  }
}


auth.onAuthStateChanged((user) => {
  if (user) {
    try { localStorage.setItem('isLoggedIn', '1'); } catch(e) {}
  } else {
    try { localStorage.removeItem('isLoggedIn'); } catch(e) {}
  }
});


function getPageName() {
  const page = document.body.dataset.page;
  if (page) return page;
  return window.location.pathname.split("/").pop();
}

function createMessageBubble(role, text, timestamp = null) {
  const wrapper = document.createElement("div");
  wrapper.className = "rounded-3xl p-4 max-w-[90%] border border-white/10 shadow-xl relative";
  if (role === "assistant") {
    wrapper.classList.add("bg-surface-container-highest", "border-indigo-500/20", "mr-auto");
  } else {
    wrapper.classList.add("bg-slate-900/90", "ml-auto", "border-slate-700/60");
  }

  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : "";
  const copyButton = document.createElement("button");
  copyButton.className = "absolute top-2 right-2 text-slate-400 hover:text-white text-sm";
  copyButton.innerHTML = "📋";
  copyButton.title = "Copy message";
  copyButton.addEventListener("click", () => {
    navigator.clipboard.writeText(text).then(() => {
      copyButton.innerHTML = "✅";
      setTimeout(() => copyButton.innerHTML = "📋", 1000);
    });
  });

  wrapper.innerHTML = `
    <div class="text-sm text-slate-400 mb-2 uppercase tracking-[0.15em]">${role === "assistant" ? "🎋 BamBooChatBot" : "Bạn"} ${timeStr ? `• ${timeStr}` : ""}</div>
    <p class="text-body-md text-slate-100 whitespace-pre-wrap">${text}</p>
  `;
  wrapper.appendChild(copyButton);
  return wrapper;
}

function appendChatMessage(role, text, timestamp = null) {
  const chatContainer = document.getElementById("chatMessages");
  if (!chatContainer) return;
  chatContainer.appendChild(createMessageBubble(role, text, timestamp));
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function loadSessionHistory() {
  const sessionId = localStorage.getItem("chatSessionId");
  if (!sessionId) return;

  const user = auth.currentUser;
  if (!user) return;

  const token = await requireToken();
  if (!token) return;

  try {
    const response = await fetch(`${BACKEND_URL}/sessions/${sessionId}?userId=${user.uid}&idToken=${token}`, {
      method: "GET",
    });

    if (!response.ok) {
      console.warn("Không thể tải lịch sử session:", response.status);
      return;
    }

    const result = await response.json();
    if (result.status === "success" && result.messages) {
      result.messages.forEach(msg => {
        appendChatMessage(msg.role, msg.text, msg.timestamp);
      });
    }
  } catch (error) {
    console.error("Lỗi khi tải lịch sử:", error);
  }
}

function clearChatMessages() {
  const chatContainer = document.getElementById("chatMessages");
  if (chatContainer) {
    chatContainer.innerHTML = "";
  }
}

function _truncateName(text, maxChars = 45) {
  if (!text) return text;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3).trimEnd() + '...';
}

function startNewSession() {
  localStorage.removeItem("chatSessionId");
  clearChatMessages();
  setStatus("Đã bắt đầu session mới");
}

function exportChat() {
  const sessionId = localStorage.getItem("chatSessionId");
  if (!sessionId) {
    alert("Không có session để export.");
    return;
  }

  const user = auth.currentUser;
  if (!user) return;

  const messages = [];
  const bubbles = document.querySelectorAll("#chatMessages > div");
  bubbles.forEach(bubble => {
    const headerText = bubble.querySelector("div").textContent;
    const role = headerText.includes("BamBooChatBot") ? "assistant" : "user";
    const text = bubble.querySelector("p").textContent;
    messages.push({ role, text });
  });

  const data = {
    sessionId,
    userId: user.uid,
    exportedAt: new Date().toISOString(),
    messages
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `chat-session-${sessionId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Sessions: fetch, render, create, rename, delete
async function fetchSessions() {
  const token = await requireToken();
  if (!token) return [];

  try {
    const resp = await fetch(`${BACKEND_URL}/sessions?idToken=${token}`);
    if (!resp.ok) {
      console.error("Failed to fetch sessions", resp.status);
      return [];
    }
    const data = await resp.json();
    return data.sessions || [];
  } catch (err) {
    console.error("Error fetching sessions:", err);
    return [];
  }
}

function renderSessions(sessions) {
  const container = document.getElementById("sessionsList");
  if (!container) return;
  container.innerHTML = "";

  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<div class="px-4 py-3 text-xs text-slate-500">Không có cuộc trò chuyện nào. Bắt đầu bằng cách nhấn "New Chat".</div>';
    return;
  }

  sessions.forEach(s => {
    const el = document.createElement("div");
    el.className = "flex items-center justify-between gap-2 px-3 py-2 rounded hover:bg-slate-900/20 cursor-pointer";
    el.innerHTML = `
      <div class="truncate text-sm max-w-[180px]" title="${(s.name||'Session').replace(/\"/g,'')}">${s.name || 'Session'}</div>
      <div class="flex items-center gap-2">
        <button class="rename-session text-xs text-slate-400 hover:text-white" data-id="${s.sessionId}">✏️</button>
        <button class="delete-session text-xs text-red-400 hover:text-white" data-id="${s.sessionId}">🗑️</button>
      </div>
    `;

    el.addEventListener("click", (ev) => {
      // if clicking buttons, ignore
      if (ev.target.closest('button')) return;
      localStorage.setItem("chatSessionId", s.sessionId);
      clearChatMessages();
      setStatus(`Chọn session: ${s.name || s.sessionId}`);
      loadSessionHistory();
    });

    // rename and delete handlers
    setTimeout(() => {
      const renameBtn = el.querySelector('.rename-session');
      const delBtn = el.querySelector('.delete-session');
      if (renameBtn) {
        renameBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const newName = prompt('Tên mới cho session', s.name || '');
          if (!newName) return;
          await renameSession(s.sessionId, newName);
          const updated = await fetchSessions();
          renderSessions(updated);
        });
      }
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('Xóa session này?')) return;
          await deleteSession(s.sessionId);
          const updated = await fetchSessions();
          renderSessions(updated);
          if (localStorage.getItem('chatSessionId') === s.sessionId) {
            localStorage.removeItem('chatSessionId');
            clearChatMessages();
            setStatus('Session đã bị xóa');
          }
        });
      }
    }, 0);

    container.appendChild(el);
  });
}

async function createSession(name) {
  const token = await requireToken();
  if (!token) return null;
  try {
    const resp = await fetch(`${BACKEND_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token, name }),
    });
    if (!resp.ok) {
      console.error('Failed to create session', resp.status);
      return null;
    }
    const data = await resp.json();
    return data.sessionId;
  } catch (err) {
    console.error('Error creating session', err);
    return null;
  }
}

async function renameSession(sessionId, newName) {
  const token = await requireToken();
  if (!token) return false;
  try {
    const resp = await fetch(`${BACKEND_URL}/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token, name: newName }),
    });
    return resp.ok;
  } catch (err) {
    console.error('Error renaming session', err);
    return false;
  }
}

async function deleteSession(sessionId) {
  const token = await requireToken();
  if (!token) return false;
  try {
    const resp = await fetch(`${BACKEND_URL}/sessions/${sessionId}?idToken=${token}`, { method: 'DELETE' });
    return resp.ok;
  } catch (err) {
    console.error('Error deleting session', err);
    return false;
  }
}

function setStatus(message) {
  const statusEl = document.getElementById("authStatus");
  if (statusEl) {
    statusEl.textContent = message;
  }
}

async function requireToken() {
  const user = auth.currentUser;
  if (!user) {
    return null;
  }
  return await user.getIdToken();
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById("email")?.value?.trim();
  const password = document.getElementById("password")?.value;
  if (!email || !password) {
    alert("Vui lòng nhập email và mật khẩu.");
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(email, password);
    localStorage.setItem('isLoggedIn', '1');
    window.location.href = "homepage.html";
  } catch (error) {
    console.error("Login failed:", error);
    const code = error.code || "";
    const message = error.message || "Đăng nhập không thành công.";
    const userMessage = code
      ? `${code}: ${message}`
      : message;
    alert(userMessage);
  }
}

async function handleSignup(event) {
  event.preventDefault();
  const email = document.getElementById("email")?.value?.trim();
  const password = document.getElementById("password")?.value;
  const fullName = document.getElementById("full_name")?.value?.trim();

  if (!email || !password || !fullName) {
    alert("Vui lòng điền đầy đủ thông tin đăng ký.");
    return;
  }

  try {
    const result = await auth.createUserWithEmailAndPassword(email, password);
    if (result.user) {
      await result.user.updateProfile({ displayName: fullName });
    }
    localStorage.setItem('isLoggedIn', '1');
    window.location.href = "homepage.html";
  } catch (error) {
    console.error("Signup failed:", error);
    const code = error.code || "";
    const message = error.message || "Đăng ký không thành công.";
    const userMessage = code === "auth/email-already-in-use"
      ? "Email này đã được dùng rồi. Vui lòng đăng nhập hoặc dùng email khác."
      : code
        ? `${code}: ${message}`
        : message;
    alert(userMessage);
  }
}

async function handleGoogleSignIn(event) {
  if (event && event.preventDefault) event.preventDefault();
  const provider = new firebase.auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(provider);
    localStorage.setItem('isLoggedIn', '1');
    window.location.href = 'homepage.html';
  } catch (err) {
    console.error('Google sign-in failed:', err);
    alert('Google sign-in failed. ' + (err.message || ''));
  }
}

async function handleChatSubmit(event) {
  event.preventDefault();
  console.log("✅ handleChatSubmit called");
  
  const promptInput = document.getElementById("chatPrompt");
  if (!promptInput) {
    console.error("❌ chatPrompt input not found");
    return;
  }

  const prompt = promptInput.value.trim();
  console.log("📝 Prompt:", prompt);
  
  if (!prompt) {
    alert("Vui lòng nhập câu hỏi trước khi gửi.");
    return;
  }

  const user = auth.currentUser;
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const token = await requireToken();
  if (!token) {
    window.location.href = "login.html";
    return;
  }
  let sessionId = localStorage.getItem("chatSessionId");

  if (!sessionId) {
    const sessionName = _truncateName(prompt, 45);
    try {
      const sid = await createSession(sessionName);
      if (sid) {
        localStorage.setItem('chatSessionId', sid);
        sessionId = sid;
        // refresh sessions list in sidebar
        fetchSessions().then(renderSessions).catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to create initial session:', e);
    }
  }

  appendChatMessage("user", prompt);
  promptInput.value = "";
  appendChatMessage("assistant", "Đang xử lý yêu cầu của bạn...");

  try {
    console.log("🔄 Sending POST to:", `${BACKEND_URL}/chat`);
    console.log("📦 Request payload:", { prompt, userId: user.uid, sessionId, idToken: token });
    
    const response = await fetch(`${BACKEND_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        userId: user.uid,
        sessionId,
        idToken: token,
      }),
    });

    console.log("📥 Response status:", response.status);

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      console.error("❌ Request failed:", errorPayload);
      throw new Error(errorPayload.detail || "Lỗi khi gọi backend.");
    }

    const result = await response.json();
    if (result.status !== "success") {
      throw new Error(result.detail || "Lỗi phản hồi từ backend.");
    }

    if (result.sessionId) {
      localStorage.setItem("chatSessionId", result.sessionId);
    }

    const assistantText = result.data || "Không có phản hồi từ AI.";
    const bubbles = document.querySelectorAll("#chatMessages > div");
    if (bubbles.length > 0) {
      const lastBubble = bubbles[bubbles.length - 1];
      if (lastBubble.textContent.includes("Đang xử lý yêu cầu của bạn")) {
        lastBubble.remove();
      }
    }
    appendChatMessage("assistant", assistantText);
  } catch (error) {
    const message = error.message || "Đã xảy ra lỗi khi gửi yêu cầu.";
    appendChatMessage("assistant", message);
  }
}

function setupPage() {
  const page = getPageName();

  auth.onAuthStateChanged((user) => {
    if (page === "login" || page === "signup") {
      if (user) {
        window.location.href = "homepage.html";
      }
    }

    if (page === "homepage") {
      if (!user) {
        window.location.href = "login.html";
        return;
      }
      const displayName = user.displayName || user.email || "User";
      setStatus(`${displayName}`);
      fetchSessions().then(renderSessions).catch(err => console.error('fetchSessions after auth failed', err));

      loadSessionHistory();
    }
  });

  if (page === "login") {
    const form = document.querySelector("form");
    if (form) {
      form.addEventListener("submit", handleLogin);
    }
    const googleBtn = document.getElementById('googleSignIn');
    if (googleBtn) googleBtn.addEventListener('click', handleGoogleSignIn);
    // If localStorage indicates user is logged in, redirect immediately to homepage
    if (localStorage.getItem('isLoggedIn') === '1') {
      window.location.href = 'homepage.html';
      return;
    }
  }

  if (page === "signup") {
    const form = document.querySelector("form");
    if (form) {
      form.addEventListener("submit", handleSignup);
    }
    const googleBtn = document.getElementById('googleSignUp');
    if (googleBtn) googleBtn.addEventListener('click', handleGoogleSignIn);
    // If localStorage indicates user is logged in, redirect immediately to homepage
    if (localStorage.getItem('isLoggedIn') === '1') {
      window.location.href = 'homepage.html';
      return;
    }
  }

  if (page === "homepage") {
    console.log("📄 Initializing homepage");
    const sendButton = document.getElementById("chatSendButton");
    const promptInput = document.getElementById("chatPrompt");
    
    console.log("🔘 Send button found:", !!sendButton);
    console.log("📝 Prompt input found:", !!promptInput);

    if (sendButton) {
      sendButton.addEventListener("click", (e) => {
        console.log("🖱️ Send button clicked");
        handleChatSubmit(e);
      });
      console.log("✅ Click event listener attached to send button");
    } else {
      console.error("❌ Send button with id='chatSendButton' not found!");
    }
    
    if (promptInput) {
      promptInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          console.log("⌨️ Enter key pressed in prompt");
          event.preventDefault();
          handleChatSubmit(event);
        }
      });
      console.log("✅ Keydown event listener attached to prompt input");
    } else {
      console.error("❌ Prompt input with id='chatPrompt' not found!");
    }

    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton) {
      logoutButton.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
          await auth.signOut();
          localStorage.removeItem('isLoggedIn');
        } catch (err) {
          console.error("Logout failed:", err);
        }
        window.location.href = "login.html";
      });
    }

    // settings menu toggle (if present)
    const settingsBtn = document.getElementById('settingsButton');
    const settingsMenu = document.getElementById('settingsMenu');
    if (settingsBtn && settingsMenu) {
      settingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        settingsMenu.classList.toggle('hidden');
      });
      // wire logout inside menu
      const settingsLogout = document.getElementById('settingsLogout');
      if (settingsLogout) {
        settingsLogout.addEventListener('click', async (ev) => {
          ev.preventDefault();
          try { await auth.signOut(); } catch(err){ console.error('Logout failed', err); }
          localStorage.removeItem('isLoggedIn');
          window.location.href = 'login.html';
        });
      }
      // close menu on outside click (ignore clicks on the settings button or its children)
      document.addEventListener('click', (ev) => {
        if (!settingsMenu.classList.contains('hidden')) {
          const clickedOnSettingsBtn = ev.target && ev.target.closest && ev.target.closest('#settingsButton');
          if (!settingsMenu.contains(ev.target) && !clickedOnSettingsBtn) {
            settingsMenu.classList.add('hidden');
          }
        }
      });
    }

    // Wire New Chat button and session list
    const newChatBtn = document.getElementById("newChatButton");
    if (newChatBtn) {
      newChatBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const name = prompt('Tên session (bỏ trống để dùng tên mặc định)') || 'New session';
        const sid = await createSession(name);
        if (sid) {
          localStorage.setItem('chatSessionId', sid);
          clearChatMessages();
          setStatus(`Session mới: ${name}`);
          const sessions = await fetchSessions();
          renderSessions(sessions);
        } else {
          alert('Tạo session thất bại');
        }
      });
    }

    // Sessions and history are loaded after auth state is confirmed (see onAuthStateChanged)
  }
}

setupPage();
