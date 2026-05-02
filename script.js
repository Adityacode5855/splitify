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
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
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
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    if (isLight) {
      blobs = [
        { x: W * 0.15, y: H * 0.25, r: 280, vx: 0.18, vy: 0.12, color: "rgba(245,166,35,0.15)" },
        { x: W * 0.75, y: H * 0.65, r: 340, vx: -0.14, vy: -0.1, color: "rgba(232,131,26,0.12)" },
        { x: W * 0.55, y: H * 0.2, r: 200, vx: 0.1, vy: 0.16, color: "rgba(245,166,35,0.08)" },
        { x: W * 0.3, y: H * 0.8, r: 260, vx: -0.12, vy: 0.08, color: "rgba(100,100,255,0.06)" },
      ];
    } else {
      blobs = [
        { x: W * 0.15, y: H * 0.25, r: 280, vx: 0.18, vy: 0.12, color: "rgba(245,166,35,0.09)" },
        { x: W * 0.75, y: H * 0.65, r: 340, vx: -0.14, vy: -0.1, color: "rgba(232,131,26,0.07)" },
        { x: W * 0.55, y: H * 0.2, r: 200, vx: 0.1, vy: 0.16, color: "rgba(245,166,35,0.05)" },
        { x: W * 0.3, y: H * 0.8, r: 260, vx: -0.12, vy: 0.08, color: "rgba(100,100,255,0.04)" },
      ];
    }
  }

  window.updateCanvasColors = createBlobs;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    ctx.fillStyle = isLight ? "#f4f5fa" : "#0b0c14";
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
  document.querySelectorAll(".sun-icon").forEach(el => el.classList.toggle("hidden", theme === "dark"));
  document.querySelectorAll(".moon-icon").forEach(el => el.classList.toggle("hidden", theme === "light"));
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
  let mode = "login";

  function setMode(nextMode) {
    mode = nextMode;
    clearError();
    const isRegister = mode === "register";
    nameGroup.classList.toggle("hidden", !isRegister);
    signinTab.classList.toggle("active", !isRegister);
    registerTab.classList.toggle("active", isRegister);
    $("login-btn-text").textContent = isRegister ? "Create Account" : "Sign In";
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

  const initials = getInitials(user.name);
  $("user-avatar").textContent = initials;
  $("mobile-avatar").textContent = initials;
  $("sidebar-username").textContent = user.name;
  $("sidebar-email").textContent = user.email;

  renderGroups();
  renderGroupSelects();
  renderExpenses();
  switchPanel("groups");
}

async function logout() {
  try {
    await apiFetch("/api/logout", { method: "POST", body: JSON.stringify({}) });
  } finally {
    window.location.href = "/";
  }
}

function initNavigation() {
  document.querySelectorAll(".nav-item, .mobile-nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchPanel(btn.dataset.panel));
  });
  $("logout-btn").addEventListener("click", logout);
  $("mobile-logout-btn").addEventListener("click", logout);
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
      </div>`;
    container.appendChild(card);
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
    const g = state.groups.find(group => group.id === groupSel.value);
    payerSel.innerHTML = `<option value="">Select member</option>`;
    if (g) g.members.forEach(m => {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      payerSel.appendChild(o);
    });
  });

  $("add-expense-btn").addEventListener("click", async () => {
    const gid = groupSel.value;
    const payer = payerSel.value;
    const amount = parseFloat($("expense-amount").value);
    const desc = $("expense-desc").value.trim();
    const errBox = $("expense-error");
    errBox.classList.remove("visible");

    if (!gid) { errBox.textContent = "Select a group."; errBox.classList.add("visible"); return; }
    if (!payer) { errBox.textContent = "Select who paid."; errBox.classList.add("visible"); return; }
    if (!amount || amount <= 0) { errBox.textContent = "Enter a valid amount."; errBox.classList.add("visible"); return; }
    if (!desc) { errBox.textContent = "Add a description."; errBox.classList.add("visible"); return; }

    const icon = EXPENSE_ICONS[Math.floor(Math.random() * EXPENSE_ICONS.length)];

    try {
      $("add-expense-btn").disabled = true;
      const res = await apiFetch("/api/expenses", {
        method: "POST",
        body: JSON.stringify({ id: uid(), group_id: gid, payer, amount, desc, icon })
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

function calcSettlements(group) {
  const balances = {};
  group.members.forEach(m => { balances[m] = 0; });

  group.expenses.forEach(exp => {
    const share = exp.amount / group.members.length;
    balances[exp.payer] += exp.amount;
    group.members.forEach(m => { balances[m] -= share; });
  });

  const settlements = [];
  const pos = [];
  const neg = [];

  Object.entries(balances).forEach(([m, b]) => {
    if (b > 0.005) pos.push({ m, b });
    if (b < -0.005) neg.push({ m, b: -b });
  });

  let pi = 0, ni = 0;
  while (pi < pos.length && ni < neg.length) {
    const p = pos[pi], n = neg[ni];
    const amt = Math.min(p.b, n.b);
    settlements.push({ from: n.m, to: p.m, amount: amt });
    p.b -= amt;
    n.b -= amt;
    if (p.b < 0.005) pi++;
    if (n.b < 0.005) ni++;
  }

  return { balances, settlements };
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

function renderSummaryContent(gid) {
  const container = $("summary-content");
  container.innerHTML = "";

  if (!gid) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">S</div><p>Select a group to see the settlement summary</p></div>`;
    return;
  }

  const group = state.groups.find(g => g.id === gid);
  if (!group) return;

  if (group.expenses.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">0</div><p>No expenses in "${group.name}" yet</p><small>Add some expenses first</small></div>`;
    return;
  }

  const { balances, settlements } = calcSettlements(group);
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

  if (settlements.length === 0) {
    const settled = el("div", "all-settled");
    settled.innerHTML = `<div class="settled-icon">OK</div><p>All settled up. No payments needed.</p>`;
    container.appendChild(settled);
  } else {
    const settleTitle = el("h4", null);
    settleTitle.style.cssText = "font-family:'Syne',sans-serif;font-size:0.85rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:0.06em;margin-top:0.5rem;margin-bottom:0.5rem;";
    settleTitle.textContent = "Payments to Make";
    container.appendChild(settleTitle);

    const list = el("div", "settlement-list");
    settlements.forEach((s, i) => {
      const item = el("div", "settlement-item");
      item.style.animationDelay = `${i * 0.06}s`;
      item.innerHTML = `
        <div class="settlement-arrow"><span class="s-from">${s.from}</span><span class="s-arrow">to</span><span class="s-to">${s.to}</span></div>
        <div class="settlement-amount">${formatCurrency(s.amount)}</div>`;
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  const mbSection = el("div", "member-balances");
  mbSection.innerHTML = `<h4>Individual Balances</h4>`;
  const maxAbs = Math.max(...Object.values(balances).map(Math.abs), 1);
  const bList = el("div", "balance-list");

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
}

const COLORS = ["#f5a623", "#22c55e", "#60a5fa", "#f472b6", "#a78bfa", "#34d399", "#fb923c", "#e879f9"];
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

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initCanvas();
  initLogin();
  initNavigation();
  initGroups();
  initExpenses();
  initSummary();
  initSaveHistory();
  checkSession();
});





