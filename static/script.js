/* Splitify frontend logic: Flask authentication plus local group expense UI. */

const state = {
  user: null,
  groups: [],
  tempMembers: [],
};

const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html) node.innerHTML = html;
  return node;
};

async function apiFetch(url, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = { ...options.headers };
  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    headers: headers,
    ...options,
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { error: text };
  }

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

function showToast(msg, type = "default") {
  const t = $("toast");
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = "toast"; }, 2800);
}

function showError(msg) {
  const errorBox = $("login-error");
  errorBox.textContent = msg;
  errorBox.classList.add("visible");
  errorBox.style.animation = "none";
  errorBox.offsetHeight;
  errorBox.style.animation = "";
}

function clearError() {
  const errorBox = $("login-error");
  errorBox.textContent = "";
  errorBox.classList.remove("visible");
}

function getInitials(name = "User") {
  return name.trim().split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).slice(0, 2).join("") || "U";
}

function formatCurrency(n) {
  return "Rs " + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
async function fetchGroups() {
  if (!state.user) return;
  try {
    const data = await apiFetch("/api/groups");
    state.groups = data.groups || [];
  } catch (err) {
    console.error("Failed to fetch groups:", err);
    state.groups = [];
  }
}

function initCanvas() {
  const canvas = $("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W, H, blobs;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function createBlobs() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      blobs = [
        { x: W * 0.15, y: H * 0.25, r: 350, vx: 0.22, vy: 0.15, color: "rgba(124, 58, 237, 0.15)" }, // Violet
        { x: W * 0.75, y: H * 0.65, r: 400, vx: -0.18, vy: -0.12, color: "rgba(30, 64, 175, 0.12)" }, // Blue
        { x: W * 0.55, y: H * 0.2, r: 280, vx: 0.12, vy: 0.2, color: "rgba(16, 185, 129, 0.1)" }, // Emerald
        { x: W * 0.3, y: H * 0.8, r: 320, vx: -0.15, vy: 0.1, color: "rgba(236, 72, 153, 0.1)" }, // Pink
      ];
    } else {
      blobs = [
        { x: W * 0.15, y: H * 0.25, r: 350, vx: 0.22, vy: 0.15, color: "rgba(124, 58, 237, 0.18)" }, // Violet
        { x: W * 0.75, y: H * 0.65, r: 400, vx: -0.18, vy: -0.12, color: "rgba(30, 64, 175, 0.14)" }, // Blue
        { x: W * 0.55, y: H * 0.2, r: 280, vx: 0.12, vy: 0.2, color: "rgba(16, 185, 129, 0.12)" }, // Emerald
        { x: W * 0.3, y: H * 0.8, r: 320, vx: -0.15, vy: 0.1, color: "rgba(236, 72, 153, 0.12)" }, // Pink
      ];
    }
  }

  window.updateCanvasColors = createBlobs;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    ctx.fillStyle = isDark ? "#0b0c14" : "#f5f6fb";
    ctx.fillRect(0, 0, W, H);

    blobs.forEach(b => {
      if (b.x - b.r < 0 || b.x + b.r > W) b.vx *= -1;
      if (b.y - b.r < 0 || b.y + b.r > H) b.vy *= -1;
      b.x += b.vx;
      b.y += b.vy;

      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      grad.addColorStop(0, b.color);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    });

    requestAnimationFrame(draw);
  }

  resize();
  createBlobs();
  draw();
  window.addEventListener("resize", () => { resize(); createBlobs(); });
}

function initTheme() {
  const saved = localStorage.getItem("theme") || "dark";
  setTheme(saved);

  document.querySelectorAll(".theme-toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      setTheme(current === "dark" ? "light" : "dark");
    });
  });
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  document.querySelectorAll(".sun-icon").forEach(el => el.classList.toggle("hidden", theme === "light"));
  document.querySelectorAll(".moon-icon").forEach(el => el.classList.toggle("hidden", theme === "dark"));
  if (window.updateCanvasColors) window.updateCanvasColors();
}

function initSaveHistory() {
  const btn = $("save-history-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const allExpenses = state.groups.flatMap(g => g.expenses.map(e => ({ ...e, groupName: g.name }))).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    if (allExpenses.length === 0) {
      showToast("No history to save.", "error");
      return;
    }
    let csv = "Date,Group,Payer,Description,Amount\n";
    allExpenses.forEach(e => {
      csv += `"${e.created_at || ''}","${e.groupName}","${e.payer}","${e.desc}",${e.amount}\n`;
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "splitify-history.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

function initLogin() {
  const loginBtn = $("login-btn");
  const emailIn = $("email");
  const passIn = $("password");
  const nameIn = $("name");
  const nameGroup = $("name-group");
  const togglePw = $("toggle-pw");
  const signinTab = $("signin-tab");
  const registerTab = $("register-tab");
  const overlay = $("auth-overlay");
  const closeBtn = $("auth-close");
  const backdrop = $("auth-backdrop");
  let mode = "login";

  // Open auth modal
  function openAuth(startMode) {
    setMode(startMode || "login");
    overlay.classList.remove("hidden");
    setTimeout(() => emailIn.focus(), 200);
  }

  // Close auth modal
  function closeAuth() {
    overlay.classList.add("hidden");
    clearError();
  }

  // Wire up landing page buttons
  const navLogin = $("nav-login-btn");
  const navSignup = $("nav-signup-btn");
  const heroSignup = $("hero-signup-btn");
  if (navLogin) navLogin.addEventListener("click", () => openAuth("login"));
  if (navSignup) navSignup.addEventListener("click", () => openAuth("register"));
  if (heroSignup) heroSignup.addEventListener("click", () => openAuth("register"));
  if (closeBtn) closeBtn.addEventListener("click", closeAuth);
  if (backdrop) backdrop.addEventListener("click", closeAuth);

  // Close on Escape
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeAuth();
  });

  function setMode(nextMode) {
    mode = nextMode;
    clearError();
    const isRegister = mode === "register";
    nameGroup.classList.toggle("hidden", !isRegister);
    signinTab.classList.toggle("active", !isRegister);
    registerTab.classList.toggle("active", isRegister);
    $("login-btn-text").textContent = isRegister ? "Create Account" : "Sign In";
    $("auth-title").textContent = isRegister ? "Create your account" : "Welcome back";
    $("auth-sub").textContent = isRegister
      ? "Start splitting expenses with friends."
      : "Sign in to continue splitting expenses.";
    passIn.autocomplete = isRegister ? "new-password" : "current-password";
  }

  function setLoading(isLoading) {
    loginBtn.disabled = isLoading;
    $("login-spinner").classList.toggle("hidden", !isLoading);
    $("login-btn-text").textContent = isLoading
      ? (mode === "register" ? "Creating..." : "Signing in...")
      : (mode === "register" ? "Create Account" : "Sign In");
  }

  togglePw.addEventListener("click", () => {
    const isText = passIn.type === "text";
    passIn.type = isText ? "password" : "text";
    $("eye-icon").innerHTML = isText
      ? `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`
      : `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`;
  });

  [nameIn, emailIn, passIn].forEach(inp => {
    inp.addEventListener("keydown", e => { if (e.key === "Enter") submitAuth(); });
  });

  signinTab.addEventListener("click", () => setMode("login"));
  registerTab.addEventListener("click", () => setMode("register"));
  loginBtn.addEventListener("click", submitAuth);

  async function submitAuth() {
    clearError();
    const payload = {
      email: emailIn.value.trim(),
      password: passIn.value,
      remember: $("remember-me").checked,
    };
    if (mode === "register") payload.name = nameIn.value.trim();

    if (mode === "register" && !payload.name) { showError("Please enter your name."); return; }
    if (!payload.email || !payload.password) { showError("Please fill in all required fields."); return; }
    if (!payload.email.toLowerCase().endsWith("@gmail.com")) { showError("Please use a Gmail address ending with @gmail.com."); return; }

    setLoading(true);
    try {
      await apiFetch(mode === "register" ? "/api/register" : "/api/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      window.location.href = "/dashboard";
    } catch (err) {
      showError(err.message);
      passIn.value = "";
      passIn.focus();
    } finally {
      setLoading(false);
    }
  }
}

async function checkSession() {
  try {
    const data = await apiFetch("/api/me");
    enterDashboard(data.user);
  } catch (_) {
    state.user = null;
    if (window.location.pathname === "/dashboard") window.location.href = "/";
  }
}

async function enterDashboard(user) {
  state.user = user;
  await fetchGroups();
  $("login-section").classList.add("hidden");
  $("dashboard-section").classList.remove("hidden");

  const userDisplayName = $("user-display-name");
  if (userDisplayName) userDisplayName.textContent = user.name;
  
  renderUserAvatar(user);

  renderGroups();
  renderGroupSelects();
  renderExpenses();
  initDashboardOverview(); // Initialize analytics
  initSettings(); // Initialize settings data
  switchPanel("dashboard");
}

async function logout() {
  try {
    await apiFetch("/api/logout", { method: "POST", body: JSON.stringify({}) });
  } finally {
    window.location.href = "/";
  }
}

function initNavigation() {
  document.querySelectorAll("[data-panel]").forEach(btn => {
    btn.addEventListener("click", () => {
      const panel = btn.dataset.panel;
      if (panel) switchPanel(panel);
    });
  });
  const logoutBtn = $("logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  const mobileLogoutBtn = $("mobile-logout-btn");
  if (mobileLogoutBtn) mobileLogoutBtn.addEventListener("click", logout);
}

function switchPanel(name) {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item, .mobile-nav-item").forEach(b => {
    b.classList.toggle("active", b.dataset.panel === name);
  });
  const target = $(`panel-${name}`);
  if (target) target.classList.add("active");
  if (name === "summary") renderSummaryGroupSelect();
}

function initGroups() {
  const memberInput = $("member-input");
  const addMemberBtn = $("add-member-btn");
  const createGroupBtn = $("create-group-btn");

  function addTempMember() {
    const val = memberInput.value.trim();
    if (!val) return;
    if (state.tempMembers.includes(val)) {
      showToast(`"${val}" is already added`, "error");
      return;
    }
    state.tempMembers.push(val);
    memberInput.value = "";
    memberInput.focus();
    renderTempMembers();
  }

  memberInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addTempMember(); } });
  addMemberBtn.addEventListener("click", addTempMember);

  createGroupBtn.addEventListener("click", async () => {
    const name = $("group-name").value.trim();
    if (!name) { showToast("Enter a group name", "error"); $("group-name").focus(); return; }
    const finalMembers = [...state.tempMembers];
    if (state.user && state.user.name && !finalMembers.includes(state.user.name)) {
      finalMembers.unshift(state.user.name);
    }

    if (finalMembers.length < 2) { showToast("Add at least 1 other member", "error"); return; }

    try {
      createGroupBtn.disabled = true;
      const res = await apiFetch("/api/groups", {
        method: "POST",
        body: JSON.stringify({ id: uid(), name, members: finalMembers })
      });
      
      // Update local state and UI
      state.groups.unshift(res.group);
      state.tempMembers = [];
      $("group-name").value = "";
      renderTempMembers();
      renderGroups();
      renderGroupSelects();
      showToast(`Group "${name}" created!`, "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      createGroupBtn.disabled = false;
    }
  });
}

function renderTempMembers() {
  const list = $("members-list");
  list.innerHTML = "";
  state.tempMembers.forEach((m, i) => {
    const chip = el("div", "member-chip");
    chip.innerHTML = `
      <div class="member-chip-avatar">${getInitials(m)}</div>
      <span>${m}</span>
      <button class="member-chip-remove" data-i="${i}" title="Remove">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;
    list.appendChild(chip);
  });

  list.querySelectorAll(".member-chip-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      state.tempMembers.splice(Number(btn.dataset.i), 1);
      renderTempMembers();
    });
  });
}

const GROUP_ICONS = ["TR", "HM", "EV", "FL", "FD", "BK", "GM", "RD"];

function renderGroups() {
  const container = $("groups-list");
  $("group-count-badge").textContent = `${state.groups.length} Group${state.groups.length !== 1 ? "s" : ""}`;
  container.innerHTML = "";

  if (state.groups.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">+</div><p>No groups yet</p><small>Create your first group above</small></div>`;
    return;
  }

  state.groups.forEach((g, gi) => {
    const total = g.expenses.reduce((s, e) => s + e.amount, 0);
    const icon = GROUP_ICONS[gi % GROUP_ICONS.length];
    const card = el("div", "group-card");
    card.style.animationDelay = `${gi * 0.06}s`;

    const shownMembers = g.members.slice(0, 4);
    const overflow = g.members.length - 4;
    const avatarsHTML = shownMembers.map(m =>
      `<div class="mini-avatar" style="background:${memberColor(m, 0.15)};border-color:${memberColor(m, 0.4)};color:${memberColor(m, 1)}">${getInitials(m)}</div>`
    ).join("") + (overflow > 0 ? `<div class="mini-avatar overflow">+${overflow}</div>` : "");

    card.innerHTML = `
      <div class="group-card-header">
        <div class="group-icon">${icon}</div>
        <div class="group-meta" style="display:flex; flex-direction:column; align-items:flex-end; gap:0.2rem">
          <div style="display:flex; justify-content:flex-end; width:100%; margin-top:-0.5rem; margin-right:-0.5rem;">
            <button class="delete-group-btn" data-id="${g.id}" title="Delete Group">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
          <div class="group-expense-count">${g.expenses.length} expense${g.expenses.length !== 1 ? "s" : ""}</div>
          <div class="group-total">${formatCurrency(total)}</div>
        </div>
      </div>
      <div class="group-name">${g.name}</div>
      <div class="group-members-row">
        ${avatarsHTML}
        <span class="group-members-label">${g.members.length} member${g.members.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="group-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
        <button class="btn-ghost group-add-expense-btn" data-id="${g.id}" style="font-size: 0.75rem; padding: 0.5rem 0.75rem; flex: 1;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Expense
        </button>
      </div>`;
    container.appendChild(card);
  });

  container.querySelectorAll(".group-add-expense-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const gid = btn.dataset.id;
      switchPanel("expenses");
      $("expense-group").value = gid;
      // Trigger the change event to populate members
      $("expense-group").dispatchEvent(new Event("change"));
    });
  });

  container.querySelectorAll(".delete-group-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Are you sure you want to delete this group? All expenses will be permanently lost.")) return;
      const gid = btn.dataset.id;
      try {
        await apiFetch(`/api/groups/${gid}`, { method: "DELETE" });
        state.groups = state.groups.filter(g => g.id !== gid);
        renderGroups();
        renderGroupSelects();
        renderExpenses();
        switchPanel("groups");
        showToast("Group deleted successfully", "success");
      } catch(err) {
        showToast(err.message, "error");
      }
    });
  });
}

const EXPENSE_ICONS = ["FD", "HT", "TX", "EV", "GR", "EL", "WI", "SH"];

function initExpenses() {
  const groupSel = $("expense-group");
  const payerSel = $("expense-payer");

  groupSel.addEventListener("change", () => {
    const gid = groupSel.value;
    const g = state.groups.find(group => group.id === gid);
    payerSel.innerHTML = `<option value="">Select member</option>`;
    if (g) {
      g.members.forEach(m => {
        const o = document.createElement("option");
        o.value = m;
        o.textContent = m;
        payerSel.appendChild(o);
      });
      renderSplitParticipants(g);
    } else {
      $("split-participants-list").innerHTML = "";
    }
  });

  $("expense-split-type").addEventListener("change", () => {
    const gid = groupSel.value;
    const g = state.groups.find(group => group.id === gid);
    if (g) renderSplitParticipants(g);
  });

  $("add-expense-btn").addEventListener("click", async () => {
    const desc = $("expense-desc").value.trim();
    const splitType = $("expense-split-type").value;
    const gid = $("expense-group").value;
    const payer = $("expense-payer").value;
    const amount = parseFloat($("expense-amount").value);
    const errBox = $("expense-error");
    errBox.classList.remove("visible");


    if (!gid) { errBox.textContent = "Select a group."; errBox.classList.add("visible"); return; }
    if (!payer) { errBox.textContent = "Select who paid."; errBox.classList.add("visible"); return; }
    if (!amount || amount <= 0) { errBox.textContent = "Enter a valid amount."; errBox.classList.add("visible"); return; }
    
    // Collect split data
    let splitData;
    const participantsList = $("split-participants-list");
    const memberRows = participantsList.querySelectorAll(".split-member-row");
    
    if (splitType === "equal") {
      splitData = [];
      memberRows.forEach(row => {
        const cb = row.querySelector("input[type='checkbox']");
        if (cb.checked) splitData.push(cb.value);
      });
      if (splitData.length === 0) { errBox.textContent = "Select at least one participant."; errBox.classList.add("visible"); return; }
    } else {
      splitData = {};
      let totalExact = 0;
      memberRows.forEach(row => {
        const cb = row.querySelector("input[type='checkbox']");
        if (cb.checked) {
          const val = parseFloat(row.querySelector(".exact-input").value) || 0;
          splitData[cb.value] = val;
          totalExact += val;
        }
      });
      if (Object.keys(splitData).length === 0) { errBox.textContent = "Select at least one participant."; errBox.classList.add("visible"); return; }
      if (Math.abs(totalExact - amount) > 0.01) {
        errBox.textContent = `Sum of exact splits (₹${totalExact.toFixed(2)}) must equal total (₹${amount.toFixed(2)}).`;
        errBox.classList.add("visible");
        return;
      }
    }

    if (!desc) { errBox.textContent = "Add a description."; errBox.classList.add("visible"); return; }

    const icon = EXPENSE_ICONS[Math.floor(Math.random() * EXPENSE_ICONS.length)];

    try {
      $("add-expense-btn").disabled = true;
      const res = await apiFetch("/api/expenses", {
        method: "POST",
        body: JSON.stringify({ id: uid(), group_id: gid, payer, amount, desc, icon, split_type: splitType, split_data: splitData })
      });

      // Update local state by finding the group and pushing the new expense
      const group = state.groups.find(g => g.id === gid);
      if (group) {
        group.expenses.push(res.expense);
      }

      $("expense-amount").value = "";
      $("expense-desc").value = "";
      groupSel.value = "";
      payerSel.innerHTML = `<option value="">Select member</option>`;

      renderExpenses();
      renderGroups();
      renderGroupSelects();
      showToast(`Expense added successfully!`, "success");
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add("visible");
    } finally {
      $("add-expense-btn").disabled = false;
    }
  });
}

function renderGroupSelects() {
  const sels = [$("expense-group"), $("summary-group-select")];
  sels.forEach(sel => {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">${sel.id === "expense-group" ? "Choose a group" : "Select a group"}</option>`;
    state.groups.forEach(g => {
      const o = document.createElement("option");
      o.value = g.id;
      o.textContent = g.name;
      sel.appendChild(o);
    });
    if (cur && state.groups.find(g => g.id === cur)) sel.value = cur;
  });
}

function renderExpenses() {
  const container = $("expenses-list");
  const allExpenses = state.groups.flatMap(g => g.expenses.map(e => ({ ...e, groupName: g.name }))).reverse();
  const total = allExpenses.reduce((s, e) => s + e.amount, 0);
  $("total-badge").textContent = `${formatCurrency(total)} total`;

  container.innerHTML = "";
  if (allExpenses.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">0</div><p>No expenses yet</p><small>Add your first expense above</small></div>`;
    return;
  }

  allExpenses.forEach((e, i) => {
    const item = el("div", "expense-item");
    item.style.animationDelay = `${i * 0.04}s`;
    item.innerHTML = `
      <div class="expense-icon">${e.icon}</div>
      <div class="expense-info">
        <div class="expense-desc">${e.desc}</div>
        <div class="expense-meta">Paid by <strong>${e.payer}</strong> in ${e.groupName}</div>
      </div>
      <div class="expense-amount">${formatCurrency(e.amount)}</div>`;
    container.appendChild(item);
  });
}

// calcSettlements is now handled by the backend /api/summary endpoint.
// We keep this placeholder if any other part of the code accidentally calls it, 
// but the primary logic has moved to app.py for persistence and settlements.
function calcSettlements(group) {
  return { balances: {}, settlements: [] };
}

function renderSummaryGroupSelect() {
  renderGroupSelects();
}

function initSummary() {
  $("summary-group-select").addEventListener("change", async () => {
    const gid = $("summary-group-select").value;
    if (gid) {
      // Option to fetch live expenses per group (satisfying the prompt's explicit requirement)
      try {
        const data = await apiFetch(`/api/expenses/${gid}`);
        const group = state.groups.find(g => g.id === gid);
        if (group) {
          group.expenses = data.expenses; // sync with backend
        }
      } catch (err) {
        console.error("Failed to load expenses for group:", err);
      }
    }
    renderSummaryContent(gid);
  });
}

async function settleUp(fromUser, toUser, amount, groupId) {
  try {
    const res = await apiFetch("/api/settle", {
      method: "POST",
      body: JSON.stringify({
        group_id: groupId,
        from_user: fromUser,
        to_user: toUser,
        amount: amount
      })
    });
    showToast(res.message, "success");
    // Refresh the summary
    renderSummaryContent(groupId);
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function renderSummaryContent(gid) {
  const container = $("summary-content");
  container.innerHTML = "";

  if (!gid) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">S</div><p>Select a group to see the settlement summary</p></div>`;
    return;
  }

  try {
    const data = await apiFetch(`/api/summary/${gid}`);
    const { balances, suggested, settlements } = data;
    const group = state.groups.find(g => g.id === gid);
    if (!group) return;

    const total = group.expenses.reduce((s, e) => s + e.amount, 0);
    const perHead = total / group.members.length;

    const header = el("div", "summary-group-header");
    header.innerHTML = `
      <div class="summary-group-name">${group.name}</div>
      <div class="summary-stats">
        <div class="stat"><div class="stat-label">Total Spent</div><div class="stat-value">${formatCurrency(total)}</div></div>
        <div class="stat"><div class="stat-label">Per Person</div><div class="stat-value">${formatCurrency(perHead)}</div></div>
      </div>`;
    container.appendChild(header);

    // Suggested Payments
    if (suggested.length === 0) {
      const settled = el("div", "all-settled");
      settled.innerHTML = `<div class="settled-icon">OK</div><p>All settled up. No payments needed.</p>`;
      container.appendChild(settled);
    } else {
      const settleTitle = el("h4", null);
      settleTitle.style.cssText = "font-family:'Syne',sans-serif;font-size:0.85rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:0.06em;margin-top:1.5rem;margin-bottom:0.75rem;";
      settleTitle.textContent = "Suggested Payments";
      container.appendChild(settleTitle);

      const list = el("div", "settlement-list");
      suggested.forEach((s, i) => {
        const item = el("div", "settlement-item");
        item.style.animationDelay = `${i * 0.06}s`;
        item.innerHTML = `
          <div class="settlement-arrow">
            <span class="s-from">${s.from}</span>
            <span class="s-arrow">to</span>
            <span class="s-to">${s.to}</span>
          </div>
          <div style="display:flex; align-items:center; gap:0.75rem">
            <div class="settlement-amount">${formatCurrency(s.amount)}</div>
            <button class="btn-primary settle-btn" style="padding:0.35rem 0.8rem; font-size:0.75rem" data-from="${s.from}" data-to="${s.to}" data-amt="${s.amount}">Settle</button>
          </div>`;
        list.appendChild(item);
      });
      container.appendChild(list);
    }

    // Individual Balances
    const mbSection = el("div", "member-balances");
    mbSection.innerHTML = `<h4>Current Balances</h4>`;
    const bList = el("div", "balance-list");
    const maxAbs = Math.max(...Object.values(balances).map(Math.abs), 1);

    group.members.forEach(m => {
      const b = balances[m] || 0;
      const pct = Math.abs(b) / maxAbs * 100;
      const cls = b > 0.005 ? "positive" : b < -0.005 ? "negative" : "zero";
      const label = b > 0.005 ? `gets back ${formatCurrency(b)}` : b < -0.005 ? `owes ${formatCurrency(-b)}` : "settled";
      const item = el("div", "balance-item");
      item.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.6rem;flex:1.2">
          <div class="mini-avatar" style="background:${memberColor(m,0.15)};border-color:${memberColor(m,0.4)};color:${memberColor(m,1)};margin:0;flex-shrink:0">${getInitials(m)}</div>
          <span class="balance-name">${m}</span>
        </div>
        <div class="balance-bar-wrap"><div class="balance-bar ${cls}" style="width:${pct}%"></div></div>
        <div class="balance-val ${cls}">${label}</div>`;
      bList.appendChild(item);
    });
    mbSection.appendChild(bList);
    container.appendChild(mbSection);

    // Settlement History
    if (settlements.length > 0) {
      const historyTitle = el("h4", null);
      historyTitle.style.cssText = "font-family:'Syne',sans-serif;font-size:0.85rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:0.06em;margin-top:2rem;margin-bottom:0.75rem;";
      historyTitle.textContent = "Payment History";
      container.appendChild(historyTitle);

      const hList = el("div", "settlement-list");
      settlements.reverse().forEach((s, i) => {
        const item = el("div", "settlement-item");
        item.style.opacity = "0.8";
        item.innerHTML = `
          <div class="settlement-arrow">
            <span class="s-from" style="color:var(--text)">${s.from_user}</span>
            <span class="s-arrow">paid</span>
            <span class="s-to" style="color:var(--text)">${s.to_user}</span>
          </div>
          <div class="settlement-amount" style="background:var(--success); color:white; border:none">${formatCurrency(s.amount)}</div>`;
        hList.appendChild(item);
      });
      container.appendChild(hList);
    }

    // Attach listeners
    container.querySelectorAll(".settle-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const { from, to, amt } = btn.dataset;
        settleUp(from, to, parseFloat(amt), gid);
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Error loading summary: ${err.message}</p></div>`;
  }
}

async function initDashboardOverview() {
  try {
    const data = await apiFetch("/api/dashboard");
    
    // 1. Balance Summary
    $("overview-owe").querySelector(".oc-value").textContent = formatCurrency(data.you_owe);
    $("overview-owed").querySelector(".oc-value").textContent = formatCurrency(data.you_are_owed);
    
    // 2. Stats Cards
    $("stat-total-spent").textContent = formatCurrency(data.total_spent);
    $("stat-expense-count").textContent = data.expense_count;
    $("stat-group-count").textContent = data.group_count;

    // 3. Spending Chart
    drawSpendingChart(data.category_breakdown);

    // 4. Insights
    renderInsights(data.insights);

    // 5. Activity (dual render)
    const historyContainer = $("expenses-list");
    const dashboardContainer = $("dashboard-activity-list");
    const activity = data.recent_activity || [];
    renderActivityList(activity, historyContainer);
    renderActivityList(activity.slice(0, 5), dashboardContainer);

  } catch (err) {
    console.error("Failed to load dashboard summary:", err);
  }
}

function renderInsights(insights) {
  const container = $("insights-list");
  if (!container) return;
  if (!insights || insights.length === 0) {
    container.innerHTML = `<div class="empty-state">No insights available yet.</div>`;
    return;
  }
  container.innerHTML = insights.map(text => `
    <div class="insight-item">
      <div style="font-size: 1.1rem;">💡</div>
      <div>${text}</div>
    </div>
  `).join("");
}

function drawSpendingChart(breakdown) {
  const canvas = $("spending-chart");
  const legend = $("chart-legend");
  if (!canvas || !legend) return;

  const ctx = canvas.getContext("2d");
  const entries = Object.entries(breakdown).filter(([_, val]) => val > 0);
  const total = entries.reduce((sum, [_, val]) => sum + val, 0);
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  legend.innerHTML = "";

  if (total === 0) {
    ctx.fillStyle = "#333";
    ctx.beginPath();
    ctx.arc(100, 100, 80, 0, Math.PI * 2);
    ctx.fill();
    legend.innerHTML = `<div class="legend-item">No data for chart</div>`;
    return;
  }

  const chartColors = {
    "Food": "#ef4444",
    "Travel": "#3b82f6",
    "Entertainment": "#a78bfa",
    "Other": "#94a3b8"
  };

  let startAngle = -Math.PI / 2;
  entries.forEach(([cat, val]) => {
    const sliceAngle = (val / total) * Math.PI * 2;
    const color = chartColors[cat] || "#666";

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(100, 100);
    ctx.arc(100, 100, 80, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fill();

    startAngle += sliceAngle;

    // Legend
    const item = el("div", "legend-item");
    item.innerHTML = `<span class="legend-color" style="background:${color}"></span> ${cat}`;
    legend.appendChild(item);
  });

  // Inner circle (Donut)
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--bg-2").trim() || "#0f172a";
  ctx.beginPath();
  ctx.arc(100, 100, 50, 0, Math.PI * 2);
  ctx.fill();
}

async function initGlobalHistory() {
  // Now handled by initDashboardOverview to avoid double fetching
  // but we keep the helper function for explicit calls if needed
}

function renderActivityList(activity, container) {
  if (!container) return;
  
  if (activity.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📜</div><p>No activity yet.</p></div>`;
    return;
  }

  container.innerHTML = "";
  activity.forEach((item, i) => {
    const el = document.createElement("div");
    el.className = "activity-item";
    el.style.animationDelay = `${i * 0.05}s`;
    
    const isExpense = item.type === "expense";
    const icon = isExpense ? "💸" : "🤝";
    const mainText = isExpense 
      ? `<b>${item.payer}</b> paid <b>${formatCurrency(item.amount)}</b> for ${item.desc}`
      : `<b>${item.from_user}</b> paid <b>${formatCurrency(item.amount)}</b> to <b>${item.to_user}</b>`;
      
    el.innerHTML = `
      <div class="activity-icon">${icon}</div>
      <div class="activity-info">
        <div class="activity-main">${mainText}</div>
        <div class="activity-sub">in ${item.group_name}</div>
      </div>
      <div class="activity-time">${timeAgo(item.created_at)}</div>
    `;
    container.appendChild(el);
  });
}

function timeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

const COLORS = ["#2563eb", "#22c55e", "#60a5fa", "#f472b6", "#a78bfa", "#34d399", "#8b5cf6", "#3b82f6"];
function memberColor(name, alpha = 1) {
  let hash = 0;
  for (let c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hex = COLORS[hash % COLORS.length];
  if (alpha >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function renderSplitParticipants(group) {
  const list = $("split-participants-list");
  const splitType = $("expense-split-type").value;
  list.innerHTML = "";

  group.members.forEach(m => {
    const row = el("div", "split-member-row");
    row.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:0.2rem 0;";
    
    const left = el("div", null);
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "0.6rem";
    
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = m;
    cb.checked = true;
    cb.id = `split-cb-${m}`;
    cb.style.width = "16px";
    cb.style.height = "16px";
    cb.style.accentColor = "var(--blue)";
    
    const label = el("label", null, m);
    label.htmlFor = cb.id;
    label.style.fontSize = "0.9rem";
    label.style.cursor = "pointer";
    
    left.appendChild(cb);
    left.appendChild(label);
    row.appendChild(left);

    if (splitType === "exact") {
      const input = document.createElement("input");
      input.type = "number";
      input.className = "exact-input";
      input.placeholder = "0.00";
      input.style.width = "80px";
      input.style.padding = "0.3rem 0.5rem";
      input.style.fontSize = "0.85rem";
      input.style.borderRadius = "6px";
      input.style.border = "1px solid var(--border)";
      input.style.background = "var(--surface)";
      input.style.color = "var(--text)";
      
      cb.addEventListener("change", () => {
        input.disabled = !cb.checked;
        input.style.opacity = cb.checked ? "1" : "0.5";
      });
      
      row.appendChild(input);
    }
    
    list.appendChild(row);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initCanvas();
  initLogin();
  initNavigation();
  initGroups();
  initExpenses();
  initSummary();
  initSaveHistory();
  initDashboardOverview();
  initGlobalHistory();
  initSettings();
  checkSession();
});

function renderUserAvatar(user) {
  const avatarElements = [
    $("user-avatar"),
    $("mobile-avatar"),
    $("settings-avatar")
  ];
  
  avatarElements.forEach(el => {
    if (!el) return;
    if (user.profile_image) {
      el.innerHTML = `<img src="${user.profile_image}" alt="${user.name}">`;
      el.style.background = "transparent";
    } else {
      el.textContent = getInitials(user.name);
      el.style.background = "var(--blue)";
    }
  });
}

async function initSettings() {
  const user = state.user;
  if (!user) return;

  $("settings-user-name").textContent = user.name;
  $("settings-user-email").textContent = user.email;
  $("edit-name").value = user.name;

  // Avatar upload trigger
  const trigger = $("settings-avatar-trigger");
  if (trigger) {
    trigger.onclick = () => {
      $("permission-modal").classList.remove("hidden");
    };
  }

  // Permission modal buttons
  $("permission-cancel").onclick = () => $("permission-modal").classList.add("hidden");
  $("permission-allow").onclick = () => {
    $("permission-modal").classList.add("hidden");
    $("profileUpload").click();
  };

  // File selection
  $("profileUpload").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 2 * 1024 * 1024) {
      showToast("File size too large (max 2MB)", "error");
      return;
    }
    
    // Preview instantly
    const reader = new FileReader();
    reader.onload = (re) => {
      const avatarElements = [$("user-avatar"), $("mobile-avatar"), $("settings-avatar")];
      avatarElements.forEach(el => {
        if (el) {
          el.innerHTML = `<img src="${re.target.result}" style="opacity: 0.6">`;
        }
      });
    };
    reader.readAsDataURL(file);
    
    uploadProfileImage(file);
  };

  // Profile Update
  $("update-profile-btn").onclick = async () => {
    const newName = $("edit-name").value.trim();
    if (!newName) return showToast("Name is required", "error");
    
    try {
      const updated = await apiFetch("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ name: newName })
      });
      state.user = updated;
      $("sidebar-username").textContent = updated.name;
      $("settings-user-name").textContent = updated.name;
      const initials = getInitials(updated.name);
      if (!updated.profile_image) {
        renderUserAvatar(updated);
      }
      showToast("Profile updated", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  // Password Update
  $("change-password-btn").onclick = async () => {
    const curr = $("current-password").value;
    const next = $("new-password").value;
    if (!curr || !next) return showToast("Please fill all fields", "error");
    
    try {
      await apiFetch("/api/profile/password", {
        method: "PUT",
        body: JSON.stringify({ current_password: curr, new_password: next })
      });
      $("current-password").value = "";
      $("new-password").value = "";
      showToast("Password changed successfully", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  // Logout
  const logoutBtns = [$("logout-btn"), $("mobile-logout-btn"), $("settings-logout-btn")];
  logoutBtns.forEach(btn => {
    if (btn) btn.onclick = logout;
  });
}

async function uploadProfileImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  
  try {
    const data = await apiFetch("/api/profile/upload", {
      method: "POST",
      body: formData // Note: apiFetch needs to handle non-JSON bodies
    });
    state.user.profile_image = data.profile_image;
    renderUserAvatar(state.user);
    showToast("Profile picture updated", "success");
  } catch (err) {
    showToast(err.message, "error");
    renderUserAvatar(state.user); // Revert preview on error
  }
}






