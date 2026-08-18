const STORAGE_KEY = "rh-control-module-real-v2";
const API_MODE = location.protocol !== "file:";
let saveTimer = null;

const viewTitles = {
  dashboard: "Tableau de bord",
  employees: "Collaborateurs",
  contracts: "Contrats",
  leaves: "Congés",
  calendar: "Calendrier",
  returns: "Reprises de congé",
  alerts: "Alertes RH",
  settings: "Paramétrage",
  history: "Historique",
};

const state = {
  view: "dashboard",
  search: "",
  contractFilters: { type: "", service: "", agency: "", status: "", expiringOnly: false },
  calendarFilter: { service: "" },
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
  apiReady: false,
  databasePath: "",
  data: loadState(),
};

function defaultState() {
  return {
    currentRole: "Admin RH",
    settings: {
      contractAlertDays: [90, 60, 30, 15, 7],
      returnAlertDays: [3, 1, 0],
      workingDays: [1, 2, 3, 4, 5],
      holidays: ["2026-01-01", "2026-04-06", "2026-05-01", "2026-08-07", "2026-12-25"],
      allowExceptionalLeave: true,
      ticketEnabled: true,
    },
    employees: [],
    leaveRequests: [],
    documents: [],
    auditLog: [],
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : defaultState();
  } catch {
    return defaultState();
  }
}

function saveState() {
  if (!API_MODE) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
    return;
  }
  if (!state.apiReady) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: state.data }),
      });
      if (!response.ok) throw new Error("Sauvegarde impossible");
    } catch (error) {
      console.error(error);
      showToast("Attention : la sauvegarde dans la base a échoué.");
    }
  }, 180);
}

async function initApp() {
  if (!API_MODE) {
    render();
    return;
  }
  const content = document.getElementById("appContent");
  content.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Connexion à la base de données…</h3>
          <p>Chargement des collaborateurs, contrats, congés et historiques.</p>
        </div>
      </div>
    </section>
  `;
  try {
    const response = await fetch("/api/bootstrap");
    if (!response.ok) throw new Error("API indisponible");
    const payload = await response.json();
    state.databasePath = payload.database || "";
    state.data = payload.data || defaultState();
    state.apiReady = true;
    render();
    if (!payload.data) showToast("Base SQLite vide : ajoute le premier collaborateur pour démarrer.");
  } catch (error) {
    console.error(error);
    state.apiReady = false;
    render();
    showToast("Serveur non disponible : mode navigateur local activé.");
  }
}

function today() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDate(value) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toISO(date) {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDate(value) {
  if (!value) return "—";
  return parseDate(value).toLocaleDateString("fr-FR");
}

function addDays(value, days) {
  const d = typeof value === "string" ? parseDate(value) : new Date(value);
  d.setDate(d.getDate() + days);
  return d;
}

function diffDays(value) {
  const d = parseDate(value);
  if (!d) return null;
  return Math.ceil((d - today()) / 86400000);
}

function money(value) {
  return Number(value || 0).toLocaleString("fr-FR") + " FCFA";
}

function fullName(employee) {
  return `${employee.firstName} ${employee.lastName}`;
}

function getEmployee(id) {
  return state.data.employees.find((employee) => employee.id === id);
}

function getCurrentContract(employee) {
  return employee.contracts[employee.contracts.length - 1];
}

function statusTag(status) {
  const color =
    status.includes("échéance") || status.includes("Refusé") || status.includes("Alerte") || status.includes("aujourd")
      ? "red"
      : status.includes("renouveler") || status.includes("attente") || status.includes("envoyée") || status.includes("À venir")
        ? "orange"
        : status.includes("Validé") || status.includes("actif") || status.includes("transmis")
          ? "green"
          : status.includes("Direction")
            ? "purple"
            : "gray";
  return `<span class="tag ${color}">${status}</span>`;
}

function getContractComputedStatus(contract) {
  if (!contract.end) return "Contrat actif";
  const days = diffDays(contract.end);
  if (days < 0) return "Contrat arrivé à échéance";
  if (days <= 30) return "Contrat à renouveler";
  if (days <= Math.max(...state.data.settings.contractAlertDays)) return "Contrat arrivant à échéance";
  if (contract.status === "Contrat renouvelé") return "Contrat renouvelé";
  return "Contrat actif";
}

function calcLeaveDays(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate || endDate < startDate) return 0;
  const holidays = new Set(state.data.settings.holidays);
  let count = 0;
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    if (state.data.settings.workingDays.includes(d.getDay()) && !holidays.has(toISO(d))) {
      count += 1;
    }
  }
  return count;
}

function calcReturnDate(end) {
  if (!end) return "";
  let d = addDays(end, 1);
  const holidays = new Set(state.data.settings.holidays);
  while (!state.data.settings.workingDays.includes(d.getDay()) || holidays.has(toISO(d))) {
    d = addDays(d, 1);
  }
  return toISO(d);
}

function isBetween(date, start, end) {
  const d = parseDate(date);
  return d >= parseDate(start) && d <= parseDate(end);
}

function isThisWeek(value) {
  const d = parseDate(value);
  const now = today();
  const day = now.getDay() || 7;
  const monday = addDays(now, 1 - day);
  const sunday = addDays(monday, 6);
  return d >= monday && d <= sunday;
}

function filterText(rowText) {
  const query = state.search.trim().toLowerCase();
  return !query || rowText.toLowerCase().includes(query);
}

function audit(actor, action) {
  state.data.auditLog.unshift({ date: toISO(today()), actor, action });
}

function generateAlerts() {
  const alerts = [];
  const maxContractAlert = Math.max(...state.data.settings.contractAlertDays);
  const returnAlertDays = new Set(state.data.settings.returnAlertDays);

  state.data.employees.forEach((employee) => {
    const contract = getCurrentContract(employee);
    if (contract.end) {
      const days = diffDays(contract.end);
      if (days < 0) {
        alerts.push({
          category: "Contrats",
          level: "red",
          title: "Contrat arrivé à échéance",
          detail: `${fullName(employee)} – Matricule ${employee.matricule}. Date de fin : ${formatDate(contract.end)}.`,
          days,
        });
      } else if (days <= maxContractAlert) {
        alerts.push({
          category: "Contrats",
          level: days <= 15 ? "red" : days <= 30 ? "orange" : "orange",
          title: days <= 30 ? "Contrat à renouveler" : "Contrat arrivant bientôt à échéance",
          detail: `${fullName(employee)} – ${contract.type}, échéance dans ${days} jour(s), le ${formatDate(contract.end)}.`,
          days,
        });
      }
    }
  });

  state.data.leaveRequests.forEach((leave) => {
    const employee = getEmployee(leave.employeeId);
    if (!employee) return;
    if (leave.status === "Demande envoyée") {
      alerts.push({
        category: "Congés",
        level: "blue",
        title: "Nouvelle demande de congé",
        detail: `${fullName(employee)} demande ${leave.days} jour(s), du ${formatDate(leave.start)} au ${formatDate(leave.end)}.`,
        days: 0,
      });
    }
    if (leave.status === "En attente de validation Direction") {
      alerts.push({
        category: "Congés",
        level: "orange",
        title: "Demande en attente Direction",
        detail: `${fullName(employee)} attend la validation Direction pour ${leave.days} jour(s).`,
        days: 0,
      });
    }
    if (leave.status === "Validé") {
      const daysToReturn = diffDays(leave.returnDate);
      if (returnAlertDays.has(daysToReturn)) {
        alerts.push({
          category: "Congés",
          level: daysToReturn === 0 ? "red" : "orange",
          title: daysToReturn === 0 ? "Reprise de congé aujourd'hui" : "Reprise de congé prochaine",
          detail: `${fullName(employee)} reprend le ${formatDate(leave.returnDate)}. Fin du congé : ${formatDate(leave.end)}.`,
          days: daysToReturn,
        });
      }
    }
  });

  state.data.documents
    .filter((doc) => doc.status !== "Document transmis")
    .forEach((doc) => {
      alerts.push({
        category: "Documents",
        level: "purple",
        title: doc.status,
        detail: doc.title,
        days: 0,
      });
    });

  return alerts.sort((a, b) => {
    const order = { red: 0, orange: 1, blue: 2, purple: 3, green: 4, gray: 5 };
    return order[a.level] - order[b.level] || a.days - b.days;
  });
}

function overlapsForLeave(leave) {
  const employee = getEmployee(leave.employeeId);
  if (!employee) return [];
  return state.data.leaveRequests.filter((other) => {
    if (other.id === leave.id || other.status === "Refusé") return false;
    const otherEmployee = getEmployee(other.employeeId);
    if (!otherEmployee || otherEmployee.service !== employee.service) return false;
    return parseDate(other.start) <= parseDate(leave.end) && parseDate(other.end) >= parseDate(leave.start);
  });
}

function metrics() {
  const employees = state.data.employees;
  const contracts = employees.map(getCurrentContract);
  const todayIso = toISO(today());
  const leaves = state.data.leaveRequests;
  return {
    totalEmployees: employees.length,
    activeEmployees: employees.filter((e) => e.status === "Actif").length,
    activeContracts: contracts.filter((c) => getContractComputedStatus(c) === "Contrat actif").length,
    cdd: contracts.filter((c) => c.type === "CDD").length,
    cdi: contracts.filter((c) => c.type === "CDI").length,
    expiringContracts: contracts.filter((c) => c.end && diffDays(c.end) >= 0 && diffDays(c.end) <= 90).length,
    expiredContracts: contracts.filter((c) => c.end && diffDays(c.end) < 0).length,
    currentLeaves: leaves.filter((l) => l.status === "Validé" && isBetween(todayIso, l.start, l.end)).length,
    pendingLeaves: leaves.filter((l) => ["Demande envoyée", "En attente de validation Direction"].includes(l.status)).length,
    approvedLeaves: leaves.filter((l) => l.status === "Validé").length,
    returnsToday: leaves.filter((l) => l.status === "Validé" && l.returnDate === todayIso).length,
    returnsWeek: leaves.filter((l) => l.status === "Validé" && isThisWeek(l.returnDate)).length,
    docsToProcess: state.data.documents.filter((doc) => doc.status !== "Document transmis").length,
    alerts: generateAlerts().length,
  };
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  document.getElementById("pageTitle").textContent = viewTitles[view];
  render();
}

function render() {
  const content = document.getElementById("appContent");
  const renderers = {
    dashboard: renderDashboard,
    employees: renderEmployees,
    contracts: renderContracts,
    leaves: renderLeaves,
    calendar: renderCalendar,
    returns: renderReturns,
    alerts: renderAlerts,
    settings: renderSettings,
    history: renderHistory,
  };
  content.innerHTML = renderers[state.view]();
  document.getElementById("roleSelect").value = state.data.currentRole;
  saveState();
}

function kpiCard(label, value, help, color = "") {
  return `
    <article class="card ${color}">
      <p class="kpi-label">${label}</p>
      <p class="kpi-value">${value}</p>
      <p class="kpi-help">${help}</p>
    </article>
  `;
}

function renderDashboard() {
  const m = metrics();
  const alerts = generateAlerts().slice(0, 6);
  const recent = state.data.auditLog.slice(0, 5);
  return `
    <div class="${API_MODE && state.apiReady ? "success" : "warning"}">
      ${API_MODE && state.apiReady
        ? `✅ Base de données SQLite active : ${state.databasePath}`
        : "⚠ Mode navigateur simple : lance LANCER_APPLICATION_RH.bat pour utiliser la vraie base de données."}
    </div>

    ${state.data.employees.length === 0 ? `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>Base RH vide</h3>
            <p>Aucune donnée fictive n’est chargée. Ajoute les collaborateurs réels pour commencer le suivi des contrats et congés.</p>
          </div>
          <button class="primary" data-action="add-employee">Ajouter le premier collaborateur</button>
        </div>
      </section>
    ` : ""}

    <div class="grid four">
      ${kpiCard("Collaborateurs actifs", m.activeEmployees, `${m.totalEmployees} collaborateur(s) au total`)}
      ${kpiCard("Contrats à surveiller", m.expiringContracts + m.expiredContracts, `${m.expiringContracts} proche(s), ${m.expiredContracts} expiré(s)`)}
      ${kpiCard("Demandes de congé", m.pendingLeaves, "En attente RH ou Direction")}
      ${kpiCard("Alertes RH", m.alerts, "Actions nécessitant attention")}
    </div>

    <div class="grid three">
      ${kpiCard("CDD", m.cdd, "Contrats à durée déterminée")}
      ${kpiCard("CDI", m.cdi, "Contrats à durée indéterminée")}
      ${kpiCard("Reprises cette semaine", m.returnsWeek, `${m.returnsToday} reprise(s) aujourd'hui`)}
    </div>

    <div class="grid two">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>Alertes prioritaires</h3>
            <p>Centralisation contrats, congés, reprises et documents.</p>
          </div>
          <button class="ghost" data-go="alerts">Voir tout</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Alerte</th><th>Détail</th></tr></thead>
            <tbody>
              ${alerts.map((alert) => `
                <tr>
                  <td>${tag(alert.category, alert.level)}</td>
                  <td><strong>${alert.title}</strong></td>
                  <td>${alert.detail}</td>
                </tr>
              `).join("") || `<tr><td colspan="3">Aucune alerte critique.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>Workflow congés</h3>
            <p>Vue rapide du circuit de validation.</p>
          </div>
        </div>
        <div class="timeline">
          <div class="timeline-item"><strong>1. Collaborateur</strong><span>Création et envoi de la demande.</span></div>
          <div class="timeline-item"><strong>2. Assistant RH</strong><span>Contrôle du solde, dates et chevauchements.</span></div>
          <div class="timeline-item"><strong>3. Direction</strong><span>Validation finale ou refus motivé.</span></div>
          <div class="timeline-item"><strong>4. Système</strong><span>Ticket, solde, historique et alerte de reprise.</span></div>
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Dernières opérations</h3>
          <p>Traçabilité automatique des actions importantes.</p>
        </div>
      </div>
      <div class="timeline">
        ${recent.map((item) => `<div class="timeline-item"><strong>${formatDate(item.date)} · ${item.actor}</strong><span>${item.action}</span></div>`).join("")}
      </div>
    </section>
  `;
}

function renderEmployees() {
  const rows = state.data.employees
    .filter((employee) => filterText(`${fullName(employee)} ${employee.matricule} ${employee.service} ${employee.fonction}`))
    .map((employee) => {
      const contract = getCurrentContract(employee);
      const balance = employee.leaveBalance;
      const used = Math.max(0, balance.taken + balance.planned);
      const total = Math.max(1, balance.initial + balance.acquired);
      return `
        <tr>
          <td><strong>${fullName(employee)}</strong><br><span class="muted">${employee.fonction}</span></td>
          <td>${employee.matricule}</td>
          <td>${employee.service}<br><span class="muted">${employee.agency}</span></td>
          <td>${contract.type}</td>
          <td>${statusTag(getContractComputedStatus(contract))}</td>
          <td>
            <strong>${balance.available} j</strong>
            <div class="progress"><span style="width:${Math.min(100, (used / total) * 100)}%"></span></div>
            <span class="muted">${used} jour(s) consommé(s)/planifié(s)</span>
          </td>
          <td class="mini-actions">
            <button data-action="employee-file" data-id="${employee.id}">Fiche</button>
            <button data-action="new-leave-for" data-id="${employee.id}">Congé</button>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Fiches collaborateurs</h3>
          <p>Contrat, service, fonction, solde de congés et accès rapide à la demande.</p>
        </div>
        <button class="primary" data-action="add-employee">Ajouter un collaborateur</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Collaborateur</th><th>Matricule</th><th>Service / Agence</th><th>Contrat</th><th>Statut</th><th>Solde congés</th><th>Actions</th></tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="7">Aucun collaborateur trouvé.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderContracts() {
  const services = [...new Set(state.data.employees.map((employee) => employee.service))].sort();
  const agencies = [...new Set(state.data.employees.map((employee) => employee.agency))].sort();
  const rows = state.data.employees
    .filter((employee) => {
      const contract = getCurrentContract(employee);
      const status = getContractComputedStatus(contract);
      const f = state.contractFilters;
      const textOk = filterText(`${fullName(employee)} ${employee.matricule} ${employee.service} ${employee.agency}`);
      const typeOk = !f.type || contract.type === f.type;
      const serviceOk = !f.service || employee.service === f.service;
      const agencyOk = !f.agency || employee.agency === f.agency;
      const statusOk = !f.status || status === f.status;
      const expiringOk = !f.expiringOnly || (contract.end && diffDays(contract.end) >= 0 && diffDays(contract.end) <= Math.max(...state.data.settings.contractAlertDays));
      return textOk && typeOk && serviceOk && agencyOk && statusOk && expiringOk;
    })
    .map((employee) => {
      const contract = getCurrentContract(employee);
      const status = getContractComputedStatus(contract);
      const days = contract.end ? diffDays(contract.end) : null;
      return `
        <tr>
          <td><strong>${fullName(employee)}</strong><br><span class="muted">${employee.fonction}</span></td>
          <td>${employee.matricule}</td>
          <td>${contract.type}</td>
          <td>${formatDate(contract.start)}</td>
          <td>${formatDate(contract.end)}</td>
          <td>${days === null ? "—" : days < 0 ? `${Math.abs(days)} j dépassé(s)` : `${days} j restant(s)`}</td>
          <td>${employee.service}</td>
          <td>${money(contract.salary)}</td>
          <td>${statusTag(status)}</td>
          <td class="mini-actions">
            <button data-action="renew-contract" data-employee="${employee.id}" data-contract="${contract.id}">Renouveler</button>
            <button data-action="contract-history" data-employee="${employee.id}">Historique</button>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Tableau de suivi des contrats</h3>
          <p>Surveillance automatique des échéances selon les seuils paramétrés.</p>
        </div>
        <button class="ghost" data-go="settings">Modifier les seuils</button>
      </div>
      <div class="hint">Seuils actuels : ${state.data.settings.contractAlertDays.join(", ")} jours avant échéance.</div>
      <div class="toolbar">
        <select data-contract-filter="type">
          <option value="">Tous les types</option>
          <option value="CDD" ${state.contractFilters.type === "CDD" ? "selected" : ""}>CDD</option>
          <option value="CDI" ${state.contractFilters.type === "CDI" ? "selected" : ""}>CDI</option>
          <option value="Autre" ${state.contractFilters.type === "Autre" ? "selected" : ""}>Autre</option>
        </select>
        <select data-contract-filter="service">
          <option value="">Tous les services</option>
          ${services.map((service) => `<option value="${service}" ${state.contractFilters.service === service ? "selected" : ""}>${service}</option>`).join("")}
        </select>
        <select data-contract-filter="agency">
          <option value="">Toutes les agences</option>
          ${agencies.map((agency) => `<option value="${agency}" ${state.contractFilters.agency === agency ? "selected" : ""}>${agency}</option>`).join("")}
        </select>
        <select data-contract-filter="status">
          <option value="">Tous les statuts</option>
          ${["Contrat actif", "Contrat arrivant à échéance", "Contrat à renouveler", "Contrat renouvelé", "Contrat arrivé à échéance"].map((status) => `<option value="${status}" ${state.contractFilters.status === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        <label class="tag gray"><input type="checkbox" data-contract-filter="expiringOnly" ${state.contractFilters.expiringOnly ? "checked" : ""}> Échéances uniquement</label>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Collaborateur</th><th>Matricule</th><th>Type</th><th>Début</th><th>Fin</th><th>Échéance</th><th>Service</th><th>Salaire</th><th>Statut</th><th>Actions</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderLeaves() {
  const hasEmployees = state.data.employees.length > 0;
  const employeeOptions = hasEmployees
    ? state.data.employees
      .map((employee) => `<option value="${employee.id}">${fullName(employee)} — ${employee.matricule}</option>`)
      .join("")
    : `<option value="">Aucun collaborateur enregistré</option>`;
  const rows = state.data.leaveRequests
    .filter((leave) => {
      const employee = getEmployee(leave.employeeId);
      return employee && filterText(`${fullName(employee)} ${employee.matricule} ${employee.service} ${leave.type} ${leave.status}`);
    })
    .map((leave) => {
      const employee = getEmployee(leave.employeeId);
      return `
        <tr>
          <td><strong>${fullName(employee)}</strong><br><span class="muted">${employee.service}</span></td>
          <td>${leave.type}</td>
          <td>${formatDate(leave.start)} → ${formatDate(leave.end)}<br><span class="muted">Reprise : ${formatDate(leave.returnDate)}</span></td>
          <td class="right">${leave.days}</td>
          <td>${statusTag(leave.status)}</td>
          <td>${overlapWarning(leave)}</td>
          <td class="mini-actions">${leaveActions(leave)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Nouvelle demande de congé</h3>
          <p>Les informations collaborateur sont reprises automatiquement depuis la fiche.</p>
        </div>
      </div>
      <form id="leaveForm" class="form-grid">
        <label><span>Collaborateur</span><select id="leaveEmployee">${employeeOptions}</select></label>
        <label><span>Type de congé</span><select id="leaveType"><option>Congé annuel</option><option>Congé exceptionnel</option><option>Congé maladie</option><option>Congé maternité</option><option>Autre</option></select></label>
        <label><span>Date de départ</span><input id="leaveStart" type="date" required /></label>
        <label><span>Date de fin</span><input id="leaveEnd" type="date" required /></label>
        <label><span>Date prévue de reprise</span><input id="leaveReturn" type="date" readonly /></label>
        <label><span>Pièce justificative</span><input id="leaveAttachment" placeholder="Nom du fichier si disponible" /></label>
        <label class="full"><span>Motif</span><input id="leaveReason" placeholder="Motif si nécessaire" /></label>
        <label class="full"><span>Commentaire</span><textarea id="leaveComment" placeholder="Commentaire complémentaire"></textarea></label>
        <div id="leavePreview" class="hint full">Sélectionne les dates pour voir le nombre de jours et le solde après validation.</div>
        <div class="toolbar full">
          <button class="primary" type="submit" ${hasEmployees ? "" : "disabled"}>Envoyer la demande</button>
        </div>
        ${hasEmployees ? "" : `<div class="warning full">Ajoute d’abord un collaborateur réel avant de créer une demande de congé.</div>`}
      </form>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Demandes de congés</h3>
          <p>Rôle actif : <strong>${state.data.currentRole}</strong>. Les boutons de validation changent selon ce rôle.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Collaborateur</th><th>Type</th><th>Période</th><th>Jours</th><th>Statut</th><th>Chevauchement</th><th>Actions</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7">Aucune demande.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function overlapWarning(leave) {
  const overlaps = overlapsForLeave(leave);
  if (!overlaps.length) return `<span class="tag green">Aucun</span>`;
  return `<span class="tag orange">⚠ ${overlaps.length} chevauchement(s)</span>`;
}

function leaveActions(leave) {
  const role = state.data.currentRole;
  const actions = [];
  actions.push(`<button data-action="leave-details" data-id="${leave.id}">Détails</button>`);
  if (role === "Assistant RH" || role === "Admin RH") {
    if (leave.status === "Demande envoyée" || leave.status === "Modification demandée") {
      actions.push(`<button data-action="leave-to-direction" data-id="${leave.id}">Transmettre</button>`);
      actions.push(`<button data-action="leave-modify" data-id="${leave.id}">Modifier</button>`);
      actions.push(`<button data-action="leave-refuse" data-id="${leave.id}">Refuser</button>`);
    }
  }
  if (role === "Direction" || role === "Admin RH") {
    if (leave.status === "En attente de validation Direction") {
      actions.push(`<button data-action="leave-approve" data-id="${leave.id}">Valider</button>`);
      actions.push(`<button data-action="leave-refuse" data-id="${leave.id}">Refuser</button>`);
    }
  }
  const ticket = state.data.documents.find((doc) => doc.leaveId === leave.id);
  if (ticket) actions.push(`<button data-action="view-ticket" data-id="${ticket.id}">Ticket</button>`);
  return actions.join("");
}

function renderCalendar() {
  const year = state.calendarYear;
  const month = state.calendarMonth;
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = addDays(first, -startOffset);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const todayIso = toISO(today());
  const monthName = first.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const services = [...new Set(state.data.employees.map((employee) => employee.service))].sort();

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Calendrier des congés</h3>
          <p>Visualisation mensuelle des congés validés et demandes en attente.</p>
        </div>
        <div class="toolbar">
          <button class="ghost" data-action="calendar-prev">Mois précédent</button>
          <strong>${monthName}</strong>
          <button class="ghost" data-action="calendar-next">Mois suivant</button>
        </div>
      </div>
      <div class="toolbar">
        <select id="calendarServiceFilter">
          <option value="">Tous les services</option>
          ${services.map((service) => `<option value="${service}" ${state.calendarFilter.service === service ? "selected" : ""}>${service}</option>`).join("")}
        </select>
      </div>
      <div class="calendar-head">
        <div>Lun</div><div>Mar</div><div>Mer</div><div>Jeu</div><div>Ven</div><div>Sam</div><div>Dim</div>
      </div>
      <div class="calendar-grid">
        ${days.map((d) => {
          const iso = toISO(d);
          const events = state.data.leaveRequests.filter((leave) => {
            const employee = getEmployee(leave.employeeId);
            const serviceOk = !state.calendarFilter.service || employee?.service === state.calendarFilter.service;
            return serviceOk && leave.status !== "Refusé" && isBetween(iso, leave.start, leave.end);
          });
          return `
            <div class="day ${d.getMonth() !== month ? "outside" : ""} ${iso === todayIso ? "today" : ""}">
              <div class="day-number">${d.getDate()}</div>
              ${events.map((leave) => {
                const employee = getEmployee(leave.employeeId);
                return `<span class="event">${employee ? fullName(employee) : "Collaborateur"} · ${leave.status}</span>`;
              }).join("")}
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderReturns() {
  const rows = state.data.leaveRequests
    .filter((leave) => leave.status === "Validé")
    .sort((a, b) => parseDate(a.returnDate) - parseDate(b.returnDate))
    .map((leave) => {
      const employee = getEmployee(leave.employeeId);
      const days = diffDays(leave.returnDate);
      const status = days === 0 ? "Reprise aujourd'hui" : days > 0 ? "À venir" : "Déjà repris";
      return `
        <tr>
          <td><strong>${fullName(employee)}</strong></td>
          <td>${formatDate(leave.end)}</td>
          <td>${formatDate(leave.returnDate)}</td>
          <td>${employee.service}</td>
          <td>${statusTag(status)}</td>
        </tr>
      `;
    })
    .join("");
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Reprises de congé</h3>
          <p>Les reprises du jour et prochaines reprises ressortent automatiquement.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Collaborateur</th><th>Fin du congé</th><th>Date de reprise</th><th>Service</th><th>Statut</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5">Aucune reprise à afficher.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAlerts() {
  const alerts = generateAlerts();
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Alertes RH centralisées</h3>
          <p>Une seule interface pour les contrats, congés, reprises et documents.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Catégorie</th><th>Niveau</th><th>Alerte</th><th>Détail</th></tr></thead>
          <tbody>
            ${alerts.map((alert) => `
              <tr>
                <td>${alert.category}</td>
                <td>${tag(alert.level.toUpperCase(), alert.level)}</td>
                <td><strong>${alert.title}</strong></td>
                <td>${alert.detail}</td>
              </tr>
            `).join("") || `<tr><td colspan="4">Aucune alerte active.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderSettings() {
  const s = state.data.settings;
  const days = [
    ["1", "Lundi"],
    ["2", "Mardi"],
    ["3", "Mercredi"],
    ["4", "Jeudi"],
    ["5", "Vendredi"],
    ["6", "Samedi"],
    ["0", "Dimanche"],
  ];
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Paramétrage des alertes et règles de calcul</h3>
          <p>Les seuils peuvent être modifiés sans intervention développeur.</p>
        </div>
      </div>
      <form id="settingsForm" class="settings-grid">
        <label><span>Alertes fin de contrat</span><input id="contractAlertDays" value="${s.contractAlertDays.join(", ")}" /></label>
        <label><span>Alertes reprise congé</span><input id="returnAlertDays" value="${s.returnAlertDays.join(", ")}" /></label>
        <label class="full"><span>Jours ouvrés</span>
          <div class="toolbar">
            ${days.map(([value, label]) => `
              <label class="tag gray"><input type="checkbox" name="workingDay" value="${value}" ${s.workingDays.includes(Number(value)) ? "checked" : ""}> ${label}</label>
            `).join("")}
          </div>
        </label>
        <label class="full"><span>Jours fériés</span><textarea id="holidays">${s.holidays.join("\n")}</textarea></label>
        <label><span>Autorisation exceptionnelle si solde dépassé</span>
          <select id="allowExceptionalLeave">
            <option value="true" ${s.allowExceptionalLeave ? "selected" : ""}>Oui</option>
            <option value="false" ${!s.allowExceptionalLeave ? "selected" : ""}>Non</option>
          </select>
        </label>
        <label><span>Génération automatique du ticket</span>
          <select id="ticketEnabled">
            <option value="true" ${s.ticketEnabled ? "selected" : ""}>Activée</option>
            <option value="false" ${!s.ticketEnabled ? "selected" : ""}>Désactivée</option>
          </select>
        </label>
        <div class="toolbar full">
          <button class="primary" type="submit">Enregistrer le paramétrage</button>
        </div>
      </form>
    </section>
  `;
}

function renderHistory() {
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Historique et traçabilité</h3>
          <p>Chaque action importante est historisée automatiquement.</p>
        </div>
      </div>
      <div class="timeline">
        ${state.data.auditLog.map((item) => `
          <div class="timeline-item">
            <strong>${formatDate(item.date)} · ${item.actor}</strong>
            <span>${item.action}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function tag(text, color) {
  return `<span class="tag ${color}">${text}</span>`;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
  document.getElementById("modal").innerHTML = "";
}

function openModal(title, body, footer = `<button class="ghost" data-action="close-modal">Fermer</button>`) {
  const modal = document.getElementById("modal");
  modal.innerHTML = `
    <div class="modal-card">
      <div class="panel-header">
        <div><h3>${title}</h3></div>
        <button class="ghost" data-action="close-modal">Fermer</button>
      </div>
      ${body}
      <div class="modal-footer">${footer}</div>
    </div>
  `;
  modal.classList.remove("hidden");
}

function employeeFile(id) {
  const employee = getEmployee(id);
  const contract = getCurrentContract(employee);
  const body = `
    <div class="grid two">
      <div class="hint">
        <strong>${fullName(employee)}</strong><br>
        Matricule : ${employee.matricule}<br>
        Service : ${employee.service}<br>
        Fonction : ${employee.fonction}<br>
        Agence : ${employee.agency}
      </div>
      <div class="success">
        <strong>Solde de congés</strong><br>
        Initial : ${employee.leaveBalance.initial} j<br>
        Acquis : ${employee.leaveBalance.acquired} j<br>
        Pris : ${employee.leaveBalance.taken} j<br>
        Planifiés : ${employee.leaveBalance.planned} j<br>
        Disponible : ${employee.leaveBalance.available} j
      </div>
    </div>
    <h4>Contrat actuel</h4>
    <p>${contract.type} · ${formatDate(contract.start)} → ${formatDate(contract.end)} · ${money(contract.salary)}</p>
    <p>${statusTag(getContractComputedStatus(contract))}</p>
    <h4>Historique des contrats</h4>
    <ul>${contract.history.map((item) => `<li>${item}</li>`).join("")}</ul>
  `;
  openModal("Fiche collaborateur", body);
}

function contractHistory(employeeId) {
  const employee = getEmployee(employeeId);
  const lines = employee.contracts.flatMap((contract) => contract.history);
  openModal(
    `Historique contrats — ${fullName(employee)}`,
    `<div class="timeline">${lines.map((line) => `<div class="timeline-item"><strong>${employee.matricule}</strong><span>${line}</span></div>`).join("")}</div>`
  );
}

function renewContract(employeeId, contractId) {
  const employee = getEmployee(employeeId);
  const contract = employee.contracts.find((item) => item.id === contractId);
  openModal(
    `Renouveler le contrat — ${fullName(employee)}`,
    `
      <form id="renewForm" class="form-grid">
        <input type="hidden" id="renewEmployeeId" value="${employeeId}">
        <input type="hidden" id="renewContractId" value="${contractId}">
        <label><span>Ancienne date de fin</span><input value="${formatDate(contract.end)}" disabled></label>
        <label><span>Nouvelle date de fin</span><input id="renewEnd" type="date" required></label>
        <label><span>Nouveau salaire</span><input id="renewSalary" type="number" value="${contract.salary}" required></label>
        <label class="full"><span>Document du nouveau contrat</span><input id="renewDocument" placeholder="Nom du document"></label>
      </form>
    `,
    `<button class="primary" data-action="save-renewal">Enregistrer le renouvellement</button>`
  );
}

function addEmployeeModal() {
  openModal(
    "Ajouter un collaborateur",
    `
      <form id="employeeForm" class="form-grid">
        <label><span>Prénom</span><input id="empFirstName" required></label>
        <label><span>Nom</span><input id="empLastName" required></label>
        <label><span>Matricule</span><input id="empMatricule" required></label>
        <label><span>Service</span><input id="empService" required></label>
        <label><span>Direction</span><input id="empDirection" required></label>
        <label><span>Agence</span><input id="empAgency" required></label>
        <label><span>Fonction</span><input id="empFonction" required></label>
        <label><span>Type contrat</span><select id="empContractType"><option>CDD</option><option>CDI</option><option>Autre</option></select></label>
        <label><span>Date début</span><input id="empContractStart" type="date" required></label>
        <label><span>Date fin</span><input id="empContractEnd" type="date"></label>
        <label><span>Salaire</span><input id="empSalary" type="number" value="0"></label>
        <label><span>Solde disponible</span><input id="empLeaveAvailable" type="number" value="24"></label>
      </form>
    `,
    `<button class="primary" data-action="save-employee">Enregistrer</button>`
  );
}

function leaveDetails(id) {
  const leave = state.data.leaveRequests.find((item) => item.id === id);
  const employee = getEmployee(leave.employeeId);
  const overlaps = overlapsForLeave(leave);
  const body = `
    <div class="${leave.days > employee.leaveBalance.available ? "warning" : "success"}">
      Solde disponible : ${employee.leaveBalance.available} j · Congé demandé : ${leave.days} j ·
      Solde après validation : ${employee.leaveBalance.available - leave.days} j
    </div>
    ${overlaps.length ? `<div class="warning">⚠ ${overlaps.length} collaborateur(s) du service ${employee.service} sont absents ou en demande sur cette période.</div>` : ""}
    <h4>Détails</h4>
    <p><strong>${fullName(employee)}</strong> — ${employee.matricule} — ${employee.service}</p>
    <p>${leave.type} du ${formatDate(leave.start)} au ${formatDate(leave.end)}. Reprise prévue : ${formatDate(leave.returnDate)}.</p>
    <p>Motif : ${leave.reason || "—"}</p>
    <p>Commentaire : ${leave.comment || "—"}</p>
    <h4>Observations</h4>
    <ul>${leave.observations.map((item) => `<li>${item}</li>`).join("") || "<li>Aucune observation.</li>"}</ul>
    <h4>Historique</h4>
    <ul>${leave.history.map((item) => `<li>${item}</li>`).join("")}</ul>
  `;
  openModal("Détail demande de congé", body);
}

function makeTicket(leave, employee) {
  return `TICKET DE CONGÉ

Collaborateur : ${fullName(employee)}
Matricule : ${employee.matricule}
Fonction : ${employee.fonction}
Service : ${employee.service}

Type de congé : ${leave.type}
Date de départ : ${formatDate(leave.start)}
Date de fin : ${formatDate(leave.end)}
Date de reprise : ${formatDate(leave.returnDate)}
Nombre de jours : ${leave.days}

Statut : ${leave.status}
Généré le : ${formatDate(toISO(today()))}

Observation RH / Direction :
${leave.observations.join("\n") || "Aucune observation."}`;
}

function viewTicket(id) {
  const doc = state.data.documents.find((item) => item.id === id);
  openModal(
    doc.title,
    `<pre>${escapeHtml(doc.content)}</pre><p>${statusTag(doc.status)}</p>`,
    `<button class="primary" data-action="download-ticket" data-id="${id}">Télécharger</button><button class="ghost" data-action="close-modal">Fermer</button>`
  );
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateLeavePreview() {
  const employee = getEmployee(document.getElementById("leaveEmployee")?.value);
  const start = document.getElementById("leaveStart")?.value;
  const end = document.getElementById("leaveEnd")?.value;
  const returnInput = document.getElementById("leaveReturn");
  const preview = document.getElementById("leavePreview");
  if (!employee || !start || !end || !returnInput || !preview) return;
  const days = calcLeaveDays(start, end);
  const returnDate = calcReturnDate(end);
  returnInput.value = returnDate;
  const after = employee.leaveBalance.available - days;
  const alertClass = after < 0 ? "warning" : "hint";
  preview.className = `${alertClass} full`;
  preview.innerHTML = `
    Solde disponible : <strong>${employee.leaveBalance.available} j</strong> ·
    Congé demandé : <strong>${days} j</strong> ·
    Solde après validation : <strong>${after} j</strong> ·
    Date de reprise : <strong>${formatDate(returnDate)}</strong>
    ${after < 0 ? "<br>⚠ La demande dépasse le solde disponible. Autorisation exceptionnelle requise." : ""}
  `;
}

function createLeave(event) {
  event.preventDefault();
  const employee = getEmployee(document.getElementById("leaveEmployee").value);
  if (!employee) {
    showToast("Ajoute d’abord un collaborateur réel.");
    return;
  }
  const start = document.getElementById("leaveStart").value;
  const end = document.getElementById("leaveEnd").value;
  const days = calcLeaveDays(start, end);
  const returnDate = calcReturnDate(end);
  if (!start || !end || !days) {
    showToast("Vérifie les dates de congé.");
    return;
  }
  if (days > employee.leaveBalance.available && !state.data.settings.allowExceptionalLeave) {
    showToast("Demande bloquée : solde insuffisant.");
    return;
  }
  const leave = {
    id: `leave-${Date.now()}`,
    employeeId: employee.id,
    type: document.getElementById("leaveType").value,
    start,
    end,
    returnDate,
    days,
    reason: document.getElementById("leaveReason").value,
    comment: document.getElementById("leaveComment").value,
    attachment: document.getElementById("leaveAttachment").value,
    status: "Demande envoyée",
    observations: [],
    createdAt: toISO(today()),
    history: [`${formatDate(toISO(today()))} : demande envoyée par le collaborateur.`],
  };
  state.data.leaveRequests.unshift(leave);
  audit("Collaborateur", `${fullName(employee)} a envoyé une demande de congé de ${days} jour(s).`);
  showToast("Demande de congé envoyée.");
  render();
}

function transitionLeave(id, action) {
  const leave = state.data.leaveRequests.find((item) => item.id === id);
  const employee = getEmployee(leave.employeeId);
  const observation = prompt("Observation à enregistrer :", "") || "";
  if (action === "to-direction") {
    leave.status = "En attente de validation Direction";
    leave.observations.push(`Assistant RH : ${observation || "demande vérifiée et transmise à la Direction."}`);
    leave.history.push(`${formatDate(toISO(today()))} : demande transmise à la Direction.`);
    audit("Assistant RH", `Demande de ${fullName(employee)} transmise à la Direction.`);
    showToast("Demande transmise à la Direction.");
  }
  if (action === "modify") {
    leave.status = "Modification demandée";
    leave.observations.push(`Assistant RH : ${observation || "modification demandée."}`);
    leave.history.push(`${formatDate(toISO(today()))} : modification demandée.`);
    audit("Assistant RH", `Modification demandée pour le congé de ${fullName(employee)}.`);
    showToast("Modification demandée.");
  }
  if (action === "refuse") {
    leave.status = "Refusé";
    leave.observations.push(`${state.data.currentRole} : ${observation || "demande refusée."}`);
    leave.history.push(`${formatDate(toISO(today()))} : demande refusée.`);
    audit(state.data.currentRole, `Demande de congé refusée pour ${fullName(employee)}.`);
    showToast("Demande refusée.");
  }
  if (action === "approve") {
    leave.status = "Validé";
    leave.observations.push(`Direction : ${observation || "demande validée."}`);
    leave.history.push(`${formatDate(toISO(today()))} : demande validée par la Direction.`);
    employee.leaveBalance.taken += leave.days;
    employee.leaveBalance.available -= leave.days;
    if (state.data.settings.ticketEnabled) {
      const content = makeTicket(leave, employee);
      state.data.documents.push({
        id: `doc-${Date.now()}`,
        employeeId: employee.id,
        leaveId: leave.id,
        title: `Ticket de congé - ${fullName(employee)}`,
        status: "Document à transmettre",
        createdAt: toISO(today()),
        content,
      });
      leave.history.push(`${formatDate(toISO(today()))} : ticket de congé généré.`);
    }
    audit("Direction", `Demande de congé validée pour ${fullName(employee)}.`);
    showToast("Congé validé et ticket généré si option activée.");
  }
  render();
}

function saveRenewal() {
  const employeeId = document.getElementById("renewEmployeeId").value;
  const contractId = document.getElementById("renewContractId").value;
  const employee = getEmployee(employeeId);
  const contract = employee.contracts.find((item) => item.id === contractId);
  const oldEnd = contract.end;
  contract.end = document.getElementById("renewEnd").value;
  contract.salary = Number(document.getElementById("renewSalary").value || contract.salary);
  contract.document = document.getElementById("renewDocument").value || contract.document;
  contract.renewalDate = toISO(today());
  contract.renewalCount += 1;
  contract.status = "Contrat renouvelé";
  contract.history.push(`${formatDate(toISO(today()))} : renouvellement enregistré. Ancienne fin : ${formatDate(oldEnd)}. Nouvelle fin : ${formatDate(contract.end)}.`);
  audit("Assistant RH", `Contrat renouvelé pour ${fullName(employee)}.`);
  closeModal();
  showToast("Renouvellement enregistré avec historique conservé.");
  render();
}

function saveEmployee() {
  const firstName = document.getElementById("empFirstName").value.trim();
  const lastName = document.getElementById("empLastName").value.trim();
  const matricule = document.getElementById("empMatricule").value.trim();
  const service = document.getElementById("empService").value.trim();
  const direction = document.getElementById("empDirection").value.trim();
  const agency = document.getElementById("empAgency").value.trim();
  const fonction = document.getElementById("empFonction").value.trim();
  if (!firstName || !lastName || !matricule || !service || !fonction) {
    showToast("Merci de renseigner les champs principaux.");
    return;
  }
  const employee = {
    id: `emp-${Date.now()}`,
    matricule,
    firstName,
    lastName,
    service,
    direction,
    agency,
    fonction,
    status: "Actif",
    leaveBalance: {
      initial: Number(document.getElementById("empLeaveAvailable").value || 0),
      acquired: 0,
      taken: 0,
      planned: 0,
      available: Number(document.getElementById("empLeaveAvailable").value || 0),
    },
    contracts: [
      {
        id: `ctr-${Date.now()}`,
        type: document.getElementById("empContractType").value,
        start: document.getElementById("empContractStart").value,
        end: document.getElementById("empContractEnd").value,
        duration: "À calculer",
        fonction,
        service,
        salary: Number(document.getElementById("empSalary").value || 0),
        renewalDate: "",
        renewalCount: 0,
        document: "",
        status: "Contrat actif",
        history: [`${formatDate(toISO(today()))} : création de la fiche et du contrat.`],
      },
    ],
  };
  state.data.employees.push(employee);
  audit("Admin RH", `Création de la fiche collaborateur ${fullName(employee)}.`);
  closeModal();
  showToast("Collaborateur ajouté.");
  render();
}

function saveSettings(event) {
  event.preventDefault();
  const workingDays = Array.from(document.querySelectorAll('input[name="workingDay"]:checked')).map((input) => Number(input.value));
  state.data.settings.contractAlertDays = parseNumberList(document.getElementById("contractAlertDays").value);
  state.data.settings.returnAlertDays = parseNumberList(document.getElementById("returnAlertDays").value);
  state.data.settings.workingDays = workingDays;
  state.data.settings.holidays = document.getElementById("holidays").value.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
  state.data.settings.allowExceptionalLeave = document.getElementById("allowExceptionalLeave").value === "true";
  state.data.settings.ticketEnabled = document.getElementById("ticketEnabled").value === "true";
  audit("Admin RH", "Paramétrage des alertes et règles de congés mis à jour.");
  showToast("Paramétrage enregistré.");
  render();
}

function parseNumberList(value) {
  return value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)).sort((a, b) => b - a);
}

function downloadTicket(id) {
  const doc = state.data.documents.find((item) => item.id === id);
  const blob = new Blob([doc.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.title.replace(/\s+/g, "_").toLowerCase()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  doc.status = "Document transmis";
  audit("Assistant RH", `${doc.title} téléchargé / transmis.`);
  closeModal();
  showToast("Ticket téléchargé et marqué transmis.");
  render();
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) setView(nav.dataset.view);

  const go = event.target.closest("[data-go]");
  if (go) setView(go.dataset.go);

  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  const id = actionTarget.dataset.id;

  if (action === "close-modal") closeModal();
  if (action === "employee-file") employeeFile(id);
  if (action === "new-leave-for") {
    setView("leaves");
    setTimeout(() => {
      document.getElementById("leaveEmployee").value = id;
      updateLeavePreview();
    });
  }
  if (action === "add-employee") addEmployeeModal();
  if (action === "save-employee") saveEmployee();
  if (action === "renew-contract") renewContract(actionTarget.dataset.employee, actionTarget.dataset.contract);
  if (action === "save-renewal") saveRenewal();
  if (action === "contract-history") contractHistory(actionTarget.dataset.employee);
  if (action === "leave-details") leaveDetails(id);
  if (action === "leave-to-direction") transitionLeave(id, "to-direction");
  if (action === "leave-modify") transitionLeave(id, "modify");
  if (action === "leave-refuse") transitionLeave(id, "refuse");
  if (action === "leave-approve") transitionLeave(id, "approve");
  if (action === "view-ticket") viewTicket(id);
  if (action === "download-ticket") downloadTicket(id);
  if (action === "calendar-prev") {
    state.calendarMonth -= 1;
    if (state.calendarMonth < 0) {
      state.calendarMonth = 11;
      state.calendarYear -= 1;
    }
    render();
  }
  if (action === "calendar-next") {
    state.calendarMonth += 1;
    if (state.calendarMonth > 11) {
      state.calendarMonth = 0;
      state.calendarYear += 1;
    }
    render();
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "leaveForm") createLeave(event);
  if (event.target.id === "settingsForm") saveSettings(event);
});

document.addEventListener("input", (event) => {
  if (["leaveStart", "leaveEnd", "leaveEmployee"].includes(event.target.id)) updateLeavePreview();
});

document.addEventListener("change", (event) => {
  if (["leaveStart", "leaveEnd", "leaveEmployee"].includes(event.target.id)) updateLeavePreview();
  const filterKey = event.target.dataset.contractFilter;
  if (filterKey) {
    if (filterKey === "expiringOnly") {
      state.contractFilters.expiringOnly = event.target.checked;
    } else {
      state.contractFilters[filterKey] = event.target.value;
    }
    render();
  }
  if (event.target.id === "calendarServiceFilter") {
    state.calendarFilter.service = event.target.value;
    render();
  }
});

document.getElementById("roleSelect").addEventListener("change", (event) => {
  state.data.currentRole = event.target.value;
  showToast(`Rôle actif : ${event.target.value}`);
  render();
});

document.getElementById("globalSearch").addEventListener("input", (event) => {
  state.search = event.target.value;
  render();
});

document.getElementById("resetDemo").addEventListener("click", () => {
  if (!confirm("Réinitialiser toutes les données de l'application ?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state.data = defaultState();
  state.view = "dashboard";
  setView("dashboard");
  showToast(API_MODE ? "Base de données réinitialisée." : "Stockage navigateur réinitialisé.");
});

initApp();
