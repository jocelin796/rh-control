const STORAGE_KEY = "rh-control-module-real-v2";
const API_MODE = location.protocol !== "file:";
let saveTimer = null;
let pendingExcelFile = null;
let lastExcelPreview = null;

const viewTitles = {
  dashboard: "Tableau de bord",
  employees: "Collaborateurs",
  contracts: "Contrats",
  leaves: "Congés",
  documents: "Documents RH",
  calendar: "Calendrier",
  returns: "Reprises de congé",
  alerts: "Alertes RH",
  settings: "Paramétrage",
  history: "Historique",
};

const ROLE_CONFIG = {
  "Admin RH": {
    defaultView: "dashboard",
    views: ["dashboard", "alerts", "employees", "contracts", "leaves", "documents", "calendar", "returns", "settings", "history"],
    help: "Accès complet : administration, import Excel, paramétrage, validations et historique.",
  },
  "Assistant RH": {
    defaultView: "dashboard",
    views: ["dashboard", "alerts", "employees", "contracts", "leaves", "documents", "calendar", "returns", "history"],
    help: "Gestion opérationnelle RH : collaborateurs, contrats, congés, documents et alertes. Paramétrage réservé à l’Admin.",
  },
  "Direction": {
    defaultView: "dashboard",
    views: ["dashboard", "alerts", "leaves", "documents", "calendar", "history"],
    help: "Validation et supervision : congés, documents, alertes et calendrier.",
  },
  "Collaborateur": {
    defaultView: "dashboard",
    views: ["dashboard"],
    help: "Le collaborateur utilise l’espace salarié avec son matricule Zeus pour voir uniquement ses demandes.",
  },
};

const ACTION_ROLES = {
  "add-employee": ["Admin RH", "Assistant RH"],
  "save-employee": ["Admin RH", "Assistant RH"],
  "import-excel-modal": ["Admin RH", "Assistant RH"],
  "download-excel-template": ["Admin RH", "Assistant RH"],
  "new-leave-for": ["Admin RH", "Assistant RH"],
  "create-leave": ["Admin RH", "Assistant RH"],
  "create-document-request": ["Admin RH", "Assistant RH"],
  "renew-contract": ["Admin RH", "Assistant RH"],
  "save-renewal": ["Admin RH", "Assistant RH"],
  "leave-to-direction": ["Admin RH", "Assistant RH"],
  "leave-modify": ["Admin RH", "Assistant RH"],
  "leave-approve": ["Admin RH", "Direction"],
  "leave-refuse": ["Admin RH", "Assistant RH", "Direction"],
  "generate-doc-request": ["Admin RH", "Assistant RH"],
  "download-doc-request": ["Admin RH", "Assistant RH", "Direction"],
  "download-ticket": ["Admin RH", "Assistant RH", "Direction"],
  "transmit-doc-request": ["Admin RH", "Assistant RH"],
  "refuse-doc-request": ["Admin RH", "Assistant RH"],
  "confirm-excel-import": ["Admin RH", "Assistant RH"],
  "download-import-report": ["Admin RH", "Assistant RH"],
  "restore-template": ["Admin RH"],
  "export-data": ["Admin RH"],
  "import-data": ["Admin RH"],
  "backup-db": ["Admin RH"],
};

const DOCUMENT_TYPES = [
  "Attestation de travail",
  "Domiciliation de salaire",
  "Bulletin de salaire",
  "Fiche de congé",
  "Attestation de départ en congé annuel",
  "Certificat de travail",
  "Autres",
];

const DEFAULT_DOCUMENT_TEMPLATES = {
  "Attestation de travail": `ATTESTATION DE TRAVAIL

Je soussigné(e), Responsable des Ressources Humaines, atteste que {{nom_complet}}, matricule {{matricule}}, occupe la fonction de {{fonction}} au sein du département {{departement}}.

Type de contrat : {{type_contrat}}
Date d'embauche : {{date_embauche}}
Ville de fonction : {{ville_fonction}}

Fait le {{date_jour}}.`,
  "Domiciliation de salaire": `DOMICILIATION DE SALAIRE

Nous attestons que {{nom_complet}}, matricule {{matricule}}, est employé(e) en qualité de {{fonction}}.

Salaire de référence : {{salaire}}
Département : {{departement}}

Fait le {{date_jour}}.`,
  "Bulletin de salaire": `DEMANDE DE BULLETIN DE SALAIRE

Collaborateur : {{nom_complet}}
Matricule : {{matricule}}
Fonction : {{fonction}}
Période / précision : {{precision}}

Fait le {{date_jour}}.`,
  "Fiche de congé": `FICHE DE CONGÉ

Collaborateur : {{nom_complet}}
Matricule : {{matricule}}
Fonction : {{fonction}}
Département : {{departement}}
Solde de congé à date : {{solde_conge}} jour(s)
Solde déjà pris : {{conge_pris}} jour(s)

Précision : {{precision}}
Fait le {{date_jour}}.`,
  "Attestation de départ en congé annuel": `ATTESTATION DE DÉPART EN CONGÉ ANNUEL

Nous attestons que {{nom_complet}}, matricule {{matricule}}, part en congé annuel selon les informations validées par l'administration RH.

Fonction : {{fonction}}
Département : {{departement}}
Précision : {{precision}}

Fait le {{date_jour}}.`,
  "Certificat de travail": `CERTIFICAT DE TRAVAIL

Nous certifions que {{nom_complet}}, matricule {{matricule}}, a travaillé au sein de l'entreprise.

Date d'embauche : {{date_embauche}}
Date de départ : {{date_depart}}
Fonction : {{fonction}}
Département : {{departement}}

Fait le {{date_jour}}.`,
  "Autres": `DOCUMENT RH

Collaborateur : {{nom_complet}}
Matricule : {{matricule}}
Objet / précision : {{precision}}

Fait le {{date_jour}}.`,
};

const state = {
  view: "dashboard",
  search: "",
  contractFilters: { type: "", service: "", agency: "", status: "", expiringOnly: false },
  calendarFilter: { service: "" },
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
  apiReady: false,
  authRequired: false,
  authenticated: false,
  serverRole: "",
  emailConfigured: false,
  durableDatabase: false,
  databasePath: "",
  employeePortal: { active: false, data: null },
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
    documentRequests: [],
    documents: [],
    documentTemplates: { ...DEFAULT_DOCUMENT_TEMPLATES },
    notifications: [],
    auditLog: [],
  };
}

function normalizeData(data) {
  const base = defaultState();
  const incoming = data && typeof data === "object" ? data : {};
  const settings = { ...base.settings, ...(incoming.settings || {}) };
  const templates = { ...DEFAULT_DOCUMENT_TEMPLATES, ...(incoming.documentTemplates || {}) };
  return {
    ...base,
    ...incoming,
    settings,
    employees: Array.isArray(incoming.employees) ? incoming.employees : [],
    leaveRequests: Array.isArray(incoming.leaveRequests) ? incoming.leaveRequests : [],
    documentRequests: Array.isArray(incoming.documentRequests) ? incoming.documentRequests : [],
    documents: Array.isArray(incoming.documents) ? incoming.documents : [],
    documentTemplates: templates,
    notifications: Array.isArray(incoming.notifications) ? incoming.notifications : [],
    auditLog: Array.isArray(incoming.auditLog) ? incoming.auditLog : [],
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeData(JSON.parse(saved)) : defaultState();
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
  if (!canWriteWholeState()) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const response = await apiFetch("/api/state", {
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

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    state.apiReady = false;
    state.authenticated = false;
    renderLogin();
  }
  return response;
}

function setLoginMode(active) {
  document.body.classList.toggle("login-mode", Boolean(active));
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
    const authResponse = await fetch("/api/auth/status", { credentials: "same-origin" });
    if (authResponse.ok) {
      const auth = await authResponse.json();
      state.authRequired = Boolean(auth.authRequired);
      state.authenticated = Boolean(auth.authenticated);
      state.serverRole = state.authRequired && auth.role ? auth.role : "";
      if (state.authRequired && !state.authenticated) {
        const employeeStatus = await fetch("/api/employee/status", { credentials: "same-origin" });
        const employeeAuth = await employeeStatus.json().catch(() => ({}));
        if (employeeAuth.authenticated) {
          const employeeResponse = await fetch("/api/employee/bootstrap", { credentials: "same-origin" });
          const employeePayload = await employeeResponse.json().catch(() => ({}));
          if (employeeResponse.ok && employeePayload.ok) {
            state.employeePortal = { active: true, data: employeePayload.data };
            renderEmployeePortal();
            return;
          }
        }
        renderLogin();
        return;
      }
    }
    const response = await apiFetch("/api/bootstrap");
    if (!response.ok) throw new Error("API indisponible");
    const payload = await response.json();
    state.databasePath = payload.database || "";
    state.durableDatabase = Boolean(payload.durable);
    state.emailConfigured = Boolean(payload.emailConfigured);
    state.data = normalizeData(payload.data || defaultState());
    state.serverRole = state.authRequired && payload.role ? payload.role : state.serverRole;
    if (state.serverRole) state.data.currentRole = state.serverRole;
    state.apiReady = true;
    state.authenticated = true;
    render();
    if (!payload.data) showToast("Base SQLite vide : ajoute le premier collaborateur pour démarrer.");
  } catch (error) {
    console.error(error);
    state.apiReady = false;
    render();
    showToast("Serveur non disponible : mode navigateur local activé.");
  }
}

function renderLogin() {
  setLoginMode(true);
  document.getElementById("pageTitle").textContent = "Connexion RH";
  document.getElementById("appContent").innerHTML = `
    <section class="login-page">
      <div class="login-hero">
        <div class="login-brand">
          <div class="login-mark">P</div>
          <div>
            <strong>RH CONTROL</strong>
            <span>PALLADIUM AFRIQUE</span>
          </div>
        </div>
        <div class="hero-art" aria-hidden="true">
          <div class="africa-map">AF</div>
          <div class="target-ring"></div>
          <div class="floating-card card-one"><span></span><span></span><span></span></div>
          <div class="floating-card card-two"><strong>BI</strong><small>Alertes</small></div>
          <div class="login-person"></div>
        </div>
        <div class="hero-copy">
          <div class="hero-line"></div>
          <p class="hero-kicker">PMS GMC GROUP</p>
          <h1>GESTION RH, CONTRATS ET CONGÉS</h1>
          <p>Les données collaborateurs alimentent automatiquement les alertes, les validations, les documents RH et les priorités de décision.</p>
          <div class="hero-stats">
            <div><strong>Neon</strong><span>base durable</span></div>
            <div><strong>Excel</strong><span>import sécurisé</span></div>
            <div><strong>PDF</strong><span>documents RH</span></div>
          </div>
          <div class="hero-steps">
            <div><strong>1</strong><span>Collecte</span><small>Fiches collaborateurs</small></div>
            <div><strong>2</strong><span>Valide</span><small>RH et Direction</small></div>
            <div><strong>3</strong><span>Pilote</span><small>Alertes et décisions</small></div>
          </div>
        </div>
      </div>

      <div class="login-side">
        <div class="login-card">
          <div class="login-card-accent"></div>
          <div class="login-card-title">
            <div class="login-card-mark">P</div>
            <div>
              <h2>RAPPORT RH</h2>
              <p>Espace sécurisé — collaborateurs GMC</p>
            </div>
          </div>
          <form id="loginForm" class="secure-login-form">
            <label>
              <span>IDENTIFIANT</span>
              <select id="loginRole" autocomplete="username">
                <option>Admin RH</option>
                <option>Assistant RH</option>
                <option>Direction</option>
              </select>
            </label>
            <label>
              <span>MOT DE PASSE</span>
              <div class="password-wrap">
                <input id="loginPassword" type="password" autocomplete="current-password" placeholder="Mot de passe" required autofocus>
                <button type="button" data-action="toggle-login-password">Voir</button>
              </div>
            </label>
            <button class="login-submit" type="submit">SE CONNECTER</button>
            <button class="forgot-link" type="button" data-action="forgot-password">Mot de passe oublié ?</button>
          </form>

          <div class="employee-login-strip">
            <div>
              <strong>Espace salarié</strong>
              <span>Connexion avec le matricule Zeus</span>
            </div>
            <form id="employeeLoginForm">
              <input id="employeeLoginMatricule" placeholder="Matricule Zeus" autocomplete="username" required>
              <button type="submit">Entrer</button>
            </form>
          </div>
        </div>

        <div class="included-title"><span></span><strong>FONCTIONNALITÉS INCLUSES</strong><span></span></div>
        <div class="feature-stack">
          <div class="feature-pill"><b>KPI</b><span>Suivi RH, contrats, congés et documents</span></div>
          <div class="feature-pill"><b>BI</b><span>Tableaux de bord et tendances RH</span></div>
          <div class="feature-pill"><b>EX</b><span>Import Excel contrôlé avant validation</span></div>
          <div class="feature-pill"><b>MG</b><span>Rôles Admin, Assistant RH et Direction</span></div>
        </div>
        <p class="login-footnote">Accès strictement réservé aux collaborateurs autorisés du Groupe GMC.</p>
      </div>
    </section>
  `;
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
  return `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.matricule || "Collaborateur";
}

function getEmployee(id) {
  return state.data.employees.find((employee) => employee.id === id);
}

function getCurrentContract(employee) {
  const contracts = Array.isArray(employee?.contracts) ? employee.contracts : [];
  return contracts[contracts.length - 1] || {
    id: "",
    type: "Autre",
    start: "",
    end: "",
    salary: 0,
    history: [],
    status: "Contrat actif",
  };
}

function statusTag(status) {
  const color =
    status.includes("échéance") || status.includes("Refusé") || status.includes("Alerte") || status.includes("aujourd")
      ? "red"
      : status.includes("renouveler") || status.includes("attente") || status.includes("envoyée") || status.includes("À venir")
        ? "orange"
        : status.includes("Validé") || status.includes("actif") || status.includes("transmis") || status.includes("prêt")
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

  state.data.documentRequests
    .filter((request) => !["Document transmis", "Refusé"].includes(request.status))
    .forEach((request) => {
      const employee = getEmployee(request.employeeId);
      alerts.push({
        category: "Documents",
        level: "purple",
        title: request.status,
        detail: `${request.type} — ${employee ? fullName(employee) : "Collaborateur"}`,
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
    pendingRhLeaves: leaves.filter((l) => ["Demande envoyée", "Modification demandée"].includes(l.status)).length,
    pendingDirectionLeaves: leaves.filter((l) => l.status === "En attente de validation Direction").length,
    approvedLeaves: leaves.filter((l) => l.status === "Validé").length,
    returnsToday: leaves.filter((l) => l.status === "Validé" && l.returnDate === todayIso).length,
    returnsWeek: leaves.filter((l) => l.status === "Validé" && isThisWeek(l.returnDate)).length,
    docsToProcess:
      state.data.documents.filter((doc) => doc.status !== "Document transmis").length
      + state.data.documentRequests.filter((doc) => !["Document transmis", "Refusé"].includes(doc.status)).length,
    alerts: generateAlerts().length,
  };
}

function decisionMetrics() {
  const buckets = new Map();
  const ensure = (service) => {
    const key = service || "Non renseigné";
    if (!buckets.has(key)) {
      buckets.set(key, {
        service: key,
        employees: 0,
        expiring30: 0,
        expiring60: 0,
        expiring90: 0,
        expired: 0,
        pendingLeaves: 0,
        lowBalances: 0,
        score: 0,
      });
    }
    return buckets.get(key);
  };
  state.data.employees.forEach((employee) => {
    const item = ensure(employee.service);
    item.employees += 1;
    const contract = getCurrentContract(employee);
    const days = contract.end ? diffDays(contract.end) : null;
    if (days !== null && days < 0) item.expired += 1;
    else if (days !== null && days <= 30) item.expiring30 += 1;
    else if (days !== null && days <= 60) item.expiring60 += 1;
    else if (days !== null && days <= 90) item.expiring90 += 1;
    if ((employee.leaveBalance?.available ?? 0) < 5) item.lowBalances += 1;
  });
  state.data.leaveRequests
    .filter((leave) => ["Demande envoyée", "Modification demandée", "En attente de validation Direction"].includes(leave.status))
    .forEach((leave) => {
      const employee = getEmployee(leave.employeeId);
      if (!employee) return;
      ensure(employee.service).pendingLeaves += 1;
    });
  const rows = [...buckets.values()].map((item) => ({
    ...item,
    score: item.expired * 5 + item.expiring30 * 4 + item.expiring60 * 2 + item.expiring90 + item.pendingLeaves * 2 + item.lowBalances,
  }));
  return {
    contract30: rows.reduce((sum, item) => sum + item.expiring30, 0),
    contract60: rows.reduce((sum, item) => sum + item.expiring60, 0),
    contract90: rows.reduce((sum, item) => sum + item.expiring90, 0),
    riskGroups: rows.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 5),
    stableGroups: rows.filter((item) => item.score === 0).sort((a, b) => b.employees - a.employees).slice(0, 5),
  };
}

function currentRole() {
  if (state.employeePortal.active) return "Collaborateur";
  return state.serverRole || state.data.currentRole || "Admin RH";
}

function roleConfig(role = currentRole()) {
  return ROLE_CONFIG[role] || ROLE_CONFIG["Admin RH"];
}

function canView(view, role = currentRole()) {
  return roleConfig(role).views.includes(view);
}

function canDo(action, role = currentRole()) {
  const allowedRoles = ACTION_ROLES[action];
  return !allowedRoles || allowedRoles.includes(role);
}

function canWriteWholeState(role = currentRole()) {
  return !API_MODE || ["Admin RH", "Assistant RH"].includes(role);
}

function firstAllowedView(role = currentRole()) {
  return roleConfig(role).defaultView || roleConfig(role).views[0] || "dashboard";
}

function enforceAllowedView(showMessage = false) {
  if (!canView(state.view)) {
    state.view = firstAllowedView();
    if (showMessage) showToast(`Vue réservée. Affichage adapté au rôle : ${currentRole()}.`);
  }
}

function updateRoleVisibility() {
  const role = currentRole();
  document.querySelectorAll(".nav-link").forEach((btn) => {
    const allowed = canView(btn.dataset.view, role);
    btn.hidden = !allowed;
    btn.classList.toggle("active", allowed && btn.dataset.view === state.view);
  });
  document.querySelectorAll(".nav-section").forEach((section) => {
    let hasVisibleItem = false;
    let node = section.nextElementSibling;
    while (node && !node.classList.contains("nav-section")) {
      if (node.classList.contains("nav-link") && !node.hidden) hasVisibleItem = true;
      node = node.nextElementSibling;
    }
    section.hidden = !hasVisibleItem;
  });
  const roleHelp = document.getElementById("roleHelp");
  if (roleHelp) {
    roleHelp.textContent = state.serverRole
      ? `${roleConfig(role).help} Rôle verrouillé par la session connectée.`
      : roleConfig(role).help;
  }
  const roleSelect = document.getElementById("roleSelect");
  if (roleSelect) {
    roleSelect.value = role;
    roleSelect.disabled = Boolean(state.serverRole || state.employeePortal.active);
  }
  const resetButton = document.getElementById("resetDemo");
  if (resetButton) resetButton.hidden = role !== "Admin RH";
}

function setView(view) {
  if (!canView(view)) {
    showToast(`Cette vue n’est pas disponible pour le rôle : ${currentRole()}.`);
    view = firstAllowedView();
  }
  state.view = view;
  document.getElementById("pageTitle").textContent = viewTitles[view];
  render();
}

function render() {
  setLoginMode(false);
  enforceAllowedView();
  const content = document.getElementById("appContent");
  const renderers = {
    dashboard: renderDashboard,
    employees: renderEmployees,
    contracts: renderContracts,
    leaves: renderLeaves,
    documents: renderDocuments,
    calendar: renderCalendar,
    returns: renderReturns,
    alerts: renderAlerts,
    settings: renderSettings,
    history: renderHistory,
  };
  content.innerHTML = renderers[state.view]();
  document.getElementById("roleSelect").value = currentRole();
  updateRoleVisibility();
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
  if (currentRole() === "Collaborateur") {
    return `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>👤 Espace collaborateur</h3>
            <p>Pour protéger les données RH, un collaborateur ne voit pas le back-office. Il doit utiliser son matricule Zeus sur l’écran de connexion.</p>
          </div>
          <button class="secondary" data-action="logout">Aller à la connexion salarié</button>
        </div>
        <div class="step-list">
          <div class="step"><strong>1. Se déconnecter</strong><span>Retour à l’écran de connexion.</span></div>
          <div class="step"><strong>2. Entrer le matricule Zeus</strong><span>Connexion à l’espace personnel.</span></div>
          <div class="step"><strong>3. Faire ses demandes</strong><span>Congés, documents et suivi d’avancement.</span></div>
        </div>
      </section>
    `;
  }
  const m = metrics();
  const d = decisionMetrics();
  const alerts = generateAlerts().slice(0, 6);
  const recent = state.data.auditLog.slice(0, 5);
  const recentNotifications = (state.data.notifications || []).slice(0, 4);
  const quickActions = [
    canDo("import-excel-modal") ? `<button class="action-card" data-action="import-excel-modal"><strong>📥 Importer Excel</strong><span>Créer ou mettre à jour par matricule Zeus</span></button>` : "",
    canDo("add-employee") ? `<button class="action-card" data-action="add-employee"><strong>👤 Ajouter un salarié</strong><span>Saisie manuelle d’une fiche complète</span></button>` : "",
    canView("documents") ? `<button class="action-card" data-go="documents"><strong>🗂️ Documents RH</strong><span>Demandes, modèles et génération</span></button>` : "",
    canView("alerts") ? `<button class="action-card" data-go="alerts"><strong>🔔 Voir les alertes</strong><span>Contrats, congés, reprises, documents</span></button>` : "",
  ].filter(Boolean).join("");
  return `
    <div class="${API_MODE && state.apiReady && state.durableDatabase ? "success" : "warning"} status-banner">
      <span>${API_MODE && state.apiReady
        ? `${state.durableDatabase ? "✅ Base durable active" : "⚠ Base active mais non durable"} : ${state.databasePath}`
        : "⚠ Mode navigateur simple : lance LANCER_APPLICATION_RH.bat pour utiliser la vraie base de données."}</span>
      <span class="tag ${state.durableDatabase ? "green" : "orange"}">${state.durableDatabase ? "Stockage sécurisé" : "À sécuriser"}</span>
    </div>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Actions rapides</h3>
          <p>Les opérations les plus utilisées sont ici, sans chercher dans les menus.</p>
        </div>
      </div>
      <div class="quick-actions">
        ${quickActions || `<div class="empty-state">Aucune action rapide pour ce rôle.</div>`}
      </div>
    </section>

    ${state.data.employees.length === 0 ? `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>Base RH vide</h3>
            <p>Aucune donnée fictive n’est chargée. Ajoute les collaborateurs réels pour commencer le suivi des contrats et congés.</p>
          </div>
          ${canDo("import-excel-modal") || canDo("add-employee") ? `<div class="toolbar">
            ${canDo("import-excel-modal") ? `<button class="secondary" data-action="import-excel-modal">Importer depuis Excel</button>` : ""}
            ${canDo("add-employee") ? `<button class="primary" data-action="add-employee">Ajouter manuellement</button>` : ""}
          </div>` : ""}
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

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Lecture décisionnelle</h3>
          <p>Ce qui demande une action rapide : contrats, validations, documents et soldes faibles.</p>
        </div>
      </div>
      <div class="grid four">
        ${kpiCard("Contrats ≤ 30 jours", d.contract30, "À renouveler en priorité", d.contract30 ? "orange" : "")}
        ${kpiCard("Contrats 31-60 jours", d.contract60, "À anticiper", d.contract60 ? "blue" : "")}
        ${kpiCard("Attente RH", m.pendingRhLeaves, "Demandes à contrôler par RH")}
        ${kpiCard("Attente Direction", m.pendingDirectionLeaves, "Demandes à valider/refuser")}
      </div>
      <div class="grid two">
        <div>
          <h4>Ce qui tire vers le bas</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Groupe</th><th>Risque</th><th>Détail</th></tr></thead>
              <tbody>
                ${d.riskGroups.map((item) => `
                  <tr>
                    <td><strong>${escapeHtml(item.service)}</strong><br><span class="muted">${item.employees} collaborateur(s)</span></td>
                    <td>${tag(item.score, item.score >= 8 ? "red" : "orange")}</td>
                    <td>${item.expired} expiré · ${item.expiring30} ≤30j · ${item.pendingLeaves} congé(s) · ${item.lowBalances} solde(s) bas</td>
                  </tr>
                `).join("") || `<tr><td colspan="3">Aucun groupe à risque actuellement.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h4>Ce qui tire vers le haut</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Groupe</th><th>Situation</th><th>Lecture</th></tr></thead>
              <tbody>
                ${d.stableGroups.map((item) => `
                  <tr>
                    <td><strong>${escapeHtml(item.service)}</strong></td>
                    <td>${tag("Stable", "green")}</td>
                    <td>${item.employees} collaborateur(s), aucune alerte majeure détectée.</td>
                  </tr>
                `).join("") || `<tr><td colspan="3">La stabilité apparaîtra après import des collaborateurs réels.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

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
          <h3>Notifications</h3>
          <p>${state.emailConfigured ? "Envoi e-mail activé sur le serveur." : "Journal interne actif. L’e-mail réel sera activé quand une messagerie SMTP gratuite sera branchée."}</p>
        </div>
        <span class="tag ${state.emailConfigured ? "green" : "gray"}">${state.emailConfigured ? "E-mail actif" : "E-mail à configurer"}</span>
      </div>
      <div class="timeline">
        ${recentNotifications.map((item) => `
          <div class="timeline-item">
            <strong>${escapeHtml(item.status || "Journalisé")} · ${escapeHtml(item.subject || "")}</strong>
            <span>${escapeHtml(item.body || "")}</span>
          </div>
        `).join("") || `<div class="empty-state">Aucune notification enregistrée pour le moment.</div>`}
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Notifications e-mail</h3>
          <p>Les demandes créent toujours une trace interne. L’envoi e-mail réel dépend du paramétrage serveur SMTP.</p>
        </div>
        <span class="tag ${state.emailConfigured ? "green" : "orange"}">${state.emailConfigured ? "SMTP actif" : "SMTP non configuré"}</span>
      </div>
      <div class="hint">
        Événements prévus : nouvelle demande de congé, demande transmise à la Direction, validation/refus, nouvelle demande de document.
        Pour rester gratuit, on branchera une messagerie SMTP gratuite quand tu me donneras les accès techniques.
      </div>
    </section>

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
          <td><strong>${fullName(employee)}</strong><br><span class="muted">${employee.fonction || "—"}</span></td>
          <td>${employee.matricule}</td>
          <td>${employee.service || "—"}<br><span class="muted">${employee.agency || "—"} · ${employee.phone || employee.email || "contact non renseigné"}</span></td>
          <td>${contract.type}</td>
          <td>${statusTag(getContractComputedStatus(contract))}</td>
          <td>
            <strong>${balance.available} j</strong>
            <div class="progress"><span style="width:${Math.min(100, (used / total) * 100)}%"></span></div>
            <span class="muted">${used} jour(s) consommé(s)/planifié(s)</span>
          </td>
          <td class="mini-actions">
            <button data-action="employee-file" data-id="${employee.id}">Fiche</button>
            ${canDo("new-leave-for") ? `<button data-action="new-leave-for" data-id="${employee.id}">Congé</button>` : ""}
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
        <div class="toolbar">
          ${canDo("download-excel-template") ? `<button class="ghost" data-action="download-excel-template">Télécharger modèle Excel</button>` : ""}
          ${canDo("import-excel-modal") ? `<button class="secondary" data-action="import-excel-modal">Importer Excel</button>` : ""}
          ${canDo("add-employee") ? `<button class="primary" data-action="add-employee">Ajouter un collaborateur</button>` : ""}
        </div>
      </div>
      ${canDo("import-excel-modal") ? `<div class="step-list">
        <div class="step"><strong>1. Télécharger</strong><span>Récupère le modèle Excel avec les bonnes colonnes.</span></div>
        <div class="step"><strong>2. Remplir</strong><span>Le matricule Zeus sert de clé unique pour chaque salarié.</span></div>
        <div class="step"><strong>3. Importer</strong><span>Les fiches existantes sont mises à jour automatiquement.</span></div>
      </div>
      <br>` : ""}
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
            ${canDo("renew-contract") ? `<button data-action="renew-contract" data-employee="${employee.id}" data-contract="${contract.id}">Renouveler</button>` : ""}
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
    ${canDo("create-leave") ? `<section class="panel">
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
    </section>` : ""}

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Demandes de congés</h3>
          <p>Rôle actif : <strong>${currentRole()}</strong>. Les boutons de validation changent selon ce rôle.</p>
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
  const role = currentRole();
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

function renderDocuments() {
  const hasEmployees = state.data.employees.length > 0;
  const employeeOptions = hasEmployees
    ? state.data.employees
      .map((employee) => `<option value="${employee.id}">${fullName(employee)} — ${employee.matricule}</option>`)
      .join("")
    : `<option value="">Aucun collaborateur enregistré</option>`;
  const typeOptions = DOCUMENT_TYPES.map((type) => `<option>${type}</option>`).join("");
  const rows = state.data.documentRequests
    .filter((request) => {
      const employee = getEmployee(request.employeeId);
      return employee && filterText(`${fullName(employee)} ${employee.matricule} ${request.type} ${request.status}`);
    })
    .map((request) => {
      const employee = getEmployee(request.employeeId);
      return `
        <tr>
          <td><strong>${fullName(employee)}</strong><br><span class="muted">${employee.matricule}</span></td>
          <td>${request.type}</td>
          <td>${formatDate(request.createdAt)}<br><span class="muted">${request.details || "—"}</span></td>
          <td>${statusTag(request.status)}</td>
          <td class="mini-actions">${documentRequestActions(request)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    ${canDo("create-document-request") ? `<section class="panel">
      <div class="panel-header">
        <div>
          <h3>Nouvelle demande de document</h3>
          <p>Création côté RH ou suivi des demandes envoyées par les salariés depuis leur matricule Zeus.</p>
        </div>
      </div>
      <form id="documentRequestForm" class="form-grid">
        <label><span>Collaborateur</span><select id="docEmployee">${employeeOptions}</select></label>
        <label><span>Type de document</span><select id="docType">${typeOptions}</select></label>
        <label class="full"><span>Précision / période / objet</span><textarea id="docDetails" placeholder="Ex : bulletin de juillet 2026, banque, période, précision pour Autres..."></textarea></label>
        <div class="toolbar full">
          <button class="primary" type="submit" ${hasEmployees ? "" : "disabled"}>Enregistrer la demande</button>
        </div>
      </form>
      <div class="columns-list">
        ${DOCUMENT_TYPES.map((type) => `<span class="tag blue">${type}</span>`).join("")}
      </div>
    </section>` : ""}

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Demandes de documents</h3>
          <p>Les modèles enregistrés dans Paramétrage remplissent automatiquement les informations du salarié.</p>
        </div>
        <button class="ghost" data-go="settings">Gérer les modèles</button>
      </div>
      <div class="hint">Astuce : clique sur <strong>Générer</strong> pour produire le contenu à partir du modèle, puis <strong>Télécharger</strong> ou <strong>Transmis</strong> selon le traitement.</div>
      <br>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Collaborateur</th><th>Document</th><th>Demande</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5">Aucune demande de document.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function documentRequestActions(request) {
  const actions = [`<button data-action="doc-request-details" data-id="${request.id}">Détails</button>`];
  if (!request.content && canDo("generate-doc-request")) actions.push(`<button data-action="generate-doc-request" data-id="${request.id}">Générer</button>`);
  if (request.content) {
    actions.push(`<button data-action="download-doc-request" data-format="docx" data-id="${request.id}">Word</button>`);
    actions.push(`<button data-action="download-doc-request" data-format="pdf" data-id="${request.id}">PDF</button>`);
  }
  if (request.status !== "Document transmis" && canDo("transmit-doc-request")) actions.push(`<button data-action="transmit-doc-request" data-id="${request.id}">Transmis</button>`);
  if (!["Document transmis", "Refusé"].includes(request.status) && canDo("refuse-doc-request")) actions.push(`<button data-action="refuse-doc-request" data-id="${request.id}">Refuser</button>`);
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

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Modèles de documents</h3>
          <p>Colle ici tes modèles. Les variables entre doubles accolades seront remplies automatiquement.</p>
        </div>
      </div>
      <form id="templateForm" class="form-grid">
        <label><span>Type de document</span>
          <select id="templateType">
            ${DOCUMENT_TYPES.map((type) => `<option>${type}</option>`).join("")}
          </select>
        </label>
        <label class="full"><span>Modèle</span><textarea id="templateContent" class="large-textarea">${escapeHtml(state.data.documentTemplates[DOCUMENT_TYPES[0]] || "")}</textarea></label>
        <div class="hint full">
          Variables disponibles : {{nom_complet}}, {{matricule}}, {{fonction}}, {{departement}}, {{ville_fonction}}, {{type_contrat}}, {{date_embauche}}, {{date_naissance}}, {{date_debut_contrat}}, {{date_fin_contrat}}, {{date_depart}}, {{salaire}}, {{telephone}}, {{email}}, {{cnps}}, {{situation_matrimoniale}}, {{nombre_enfants}}, {{solde_conge}}, {{conge_pris}}, {{precision}}, {{date_jour}}.
        </div>
        <div class="toolbar full">
          <button class="primary" type="submit">Enregistrer le modèle</button>
          <button class="ghost" type="button" data-action="restore-template">Remettre le modèle par défaut</button>
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
        Département : ${employee.service || "—"}<br>
        Fonction : ${employee.fonction || "—"}<br>
        Ville de fonction : ${employee.agency || "—"}<br>
        Téléphone : ${employee.phone || "—"}<br>
        Email : ${employee.email || "—"}<br>
        CNPS : ${employee.cnpsNumber || "—"}
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
    <h4>Informations personnelles</h4>
    <p>
      Date d’embauche : ${formatDate(employee.hireDate)} ·
      Date de naissance : ${formatDate(employee.birthDate)} ·
      Situation matrimoniale : ${employee.maritalStatus || "—"} ·
      Nombre d’enfants : ${employee.childrenCount ?? "—"} ·
      Date de départ : ${formatDate(employee.departureDate)}
    </p>
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

function importExcelModal() {
  openModal(
    "Importer les collaborateurs depuis Excel",
    `
      <div class="hint">
        L’import utilise le matricule Zeus comme clé. Si le matricule existe déjà, la fiche est mise à jour ; sinon elle est créée.
      </div>
      <div class="toolbar">
        <button class="ghost" data-action="download-excel-template">Télécharger le modèle Excel</button>
      </div>
      <form class="form-grid">
        <label class="full">
          <span>Fichier Excel .xlsx</span>
          <input id="employeeExcelFile" type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        </label>
      </form>
      <h4>Colonnes attendues</h4>
      <div class="columns-list">
        ${[
          "Noms et prénoms", "Matricule", "Date d’embauche", "Date de naissance", "Numéro de téléphone",
          "Adresse mail", "Numéro CNPS", "Type de contrat", "Fonctions", "Ville de fonction",
          "Département", "Situation matrimoniale", "Nombre d’enfants", "Date de début de contrat en cours",
          "Date de fin de contrat en cours", "Soldes de congé à date", "Solde de congé déjà pris", "Date de départ", "Salaire",
        ].map((item) => `<span class="tag gray">${item}</span>`).join("")}
      </div>
    `
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
        <label><span>Date d’embauche</span><input id="empHireDate" type="date"></label>
        <label><span>Date de naissance</span><input id="empBirthDate" type="date"></label>
        <label><span>Téléphone</span><input id="empPhone"></label>
        <label><span>Email</span><input id="empEmail" type="email"></label>
        <label><span>Numéro CNPS</span><input id="empCnps"></label>
        <label><span>Département</span><input id="empService" required></label>
        <label><span>Direction</span><input id="empDirection" required></label>
        <label><span>Ville de fonction</span><input id="empAgency" required></label>
        <label><span>Fonctions</span><input id="empFonction" required></label>
        <label><span>Situation matrimoniale</span><input id="empMaritalStatus"></label>
        <label><span>Nombre d’enfants</span><input id="empChildrenCount" type="number" value="0"></label>
        <label><span>Type contrat</span><select id="empContractType"><option>CDD</option><option>CDI</option><option>Autre</option></select></label>
        <label><span>Date début</span><input id="empContractStart" type="date" required></label>
        <label><span>Date fin</span><input id="empContractEnd" type="date"></label>
        <label><span>Date de départ</span><input id="empDepartureDate" type="date"></label>
        <label><span>Salaire</span><input id="empSalary" type="number" value="0"></label>
        <label><span>Solde de congé à date</span><input id="empLeaveAvailable" type="number" value="24"></label>
        <label><span>Solde congé déjà pris</span><input id="empLeaveTaken" type="number" value="0"></label>
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

function createDocumentRequest(event) {
  event.preventDefault();
  const employee = getEmployee(document.getElementById("docEmployee").value);
  if (!employee) {
    showToast("Ajoute d’abord un collaborateur réel.");
    return;
  }
  const type = document.getElementById("docType").value;
  const details = document.getElementById("docDetails").value.trim();
  const request = {
    id: `docreq-${Date.now()}`,
    employeeId: employee.id,
    type,
    details,
    status: "Demande envoyée",
    createdAt: toISO(today()),
    content: "",
    history: [`${formatDate(toISO(today()))} : demande enregistrée par RH.`],
  };
  state.data.documentRequests.unshift(request);
  audit("Assistant RH", `Demande de document ${type} enregistrée pour ${fullName(employee)}.`);
  showToast("Demande de document enregistrée.");
  render();
}

function templateVariables(employee, request = {}) {
  const contract = getCurrentContract(employee);
  const balance = employee.leaveBalance || {};
  return {
    nom_complet: fullName(employee),
    matricule: employee.matricule || "",
    fonction: employee.fonction || "",
    departement: employee.service || "",
    ville_fonction: employee.agency || "",
    type_contrat: contract.type || "",
    date_embauche: formatDate(employee.hireDate),
    date_naissance: formatDate(employee.birthDate),
    date_debut_contrat: formatDate(contract.start),
    date_fin_contrat: formatDate(contract.end),
    date_depart: formatDate(employee.departureDate),
    salaire: money(contract.salary),
    telephone: employee.phone || "",
    email: employee.email || "",
    cnps: employee.cnpsNumber || "",
    situation_matrimoniale: employee.maritalStatus || "",
    nombre_enfants: employee.childrenCount ?? "",
    solde_conge: balance.available ?? 0,
    conge_pris: balance.taken ?? 0,
    precision: request.details || "",
    date_jour: formatDate(toISO(today())),
  };
}

function fillTemplate(template, employee, request = {}) {
  const values = templateVariables(employee, request);
  return String(template || "")
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => values[key] ?? "");
}

function getDocumentRequest(id) {
  return state.data.documentRequests.find((item) => item.id === id);
}

function generateDocumentRequest(id) {
  const request = getDocumentRequest(id);
  const employee = getEmployee(request.employeeId);
  const template = state.data.documentTemplates[request.type] || state.data.documentTemplates.Autres || "";
  request.content = fillTemplate(template, employee, request);
  request.status = "Document prêt";
  request.generatedAt = toISO(today());
  request.history = request.history || [];
  request.history.push(`${formatDate(toISO(today()))} : document généré automatiquement depuis le modèle.`);
  audit("Assistant RH", `${request.type} généré pour ${fullName(employee)}.`);
  showToast("Document généré depuis le modèle.");
  render();
}

function viewDocumentRequest(id) {
  const request = getDocumentRequest(id);
  const employee = getEmployee(request.employeeId);
  const body = `
    <div class="hint">
      <strong>${fullName(employee)}</strong> — ${employee.matricule}<br>
      Document : ${request.type}<br>
      Statut : ${request.status}<br>
      Précision : ${request.details || "—"}
    </div>
    ${request.content ? `<h4>Contenu généré</h4><pre>${escapeHtml(request.content)}</pre>` : `<div class="warning">Le document n’est pas encore généré.</div>`}
    <h4>Historique</h4>
    <ul>${(request.history || []).map((item) => `<li>${item}</li>`).join("") || "<li>Aucun historique.</li>"}</ul>
  `;
  openModal(
    "Détail demande de document",
    body,
    `${request.content
      ? `<button class="primary" data-action="download-doc-request" data-format="docx" data-id="${id}">Télécharger Word</button><button class="secondary" data-action="download-doc-request" data-format="pdf" data-id="${id}">Télécharger PDF</button>`
      : `<button class="primary" data-action="generate-doc-request" data-id="${id}">Générer</button>`}<button class="ghost" data-action="close-modal">Fermer</button>`
  );
}

async function downloadDocumentRequest(id, format = "docx") {
  const request = getDocumentRequest(id);
  if (!request.content) generateDocumentRequest(id);
  const refreshed = getDocumentRequest(id);
  const employee = getEmployee(refreshed.employeeId);
  const title = `${refreshed.type} - ${employee.matricule}`;
  if (API_MODE) {
    const response = await apiFetch("/api/documents/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: refreshed.content, format }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      showToast(payload.error || "Document impossible à générer.");
      return;
    }
    const blob = await response.blob();
    const extension = format === "pdf" ? "pdf" : "docx";
    downloadBlob(blob, `${refreshed.type}_${employee.matricule}.${extension}`.replace(/\s+/g, "_").toLowerCase());
    showToast(`Document ${extension.toUpperCase()} téléchargé.`);
    return;
  }
  const blob = new Blob([refreshed.content], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, `${refreshed.type}_${employee.matricule}.txt`.replace(/\s+/g, "_").toLowerCase());
  showToast("Document téléchargé.");
}

function transmitDocumentRequest(id) {
  const request = getDocumentRequest(id);
  const employee = getEmployee(request.employeeId);
  if (!request.content) request.content = fillTemplate(state.data.documentTemplates[request.type] || state.data.documentTemplates.Autres, employee, request);
  request.status = "Document transmis";
  request.history = request.history || [];
  request.history.push(`${formatDate(toISO(today()))} : document marqué transmis.`);
  audit("Assistant RH", `${request.type} transmis pour ${fullName(employee)}.`);
  showToast("Document marqué transmis.");
  closeModal();
  render();
}

function refuseDocumentRequest(id) {
  const request = getDocumentRequest(id);
  const employee = getEmployee(request.employeeId);
  const reason = prompt("Motif du refus :", "") || "demande refusée.";
  request.status = "Refusé";
  request.history = request.history || [];
  request.history.push(`${formatDate(toISO(today()))} : refus — ${reason}`);
  audit("Assistant RH", `Demande de document refusée pour ${fullName(employee)}.`);
  showToast("Demande refusée.");
  render();
}

async function transitionLeave(id, action) {
  const leave = state.data.leaveRequests.find((item) => item.id === id);
  const employee = getEmployee(leave.employeeId);
  const observation = prompt("Observation à enregistrer :", "") || "";
  if (API_MODE) {
    const response = await apiFetch("/api/admin/leave-transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, observation }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      showToast(payload.error || "Action impossible pour ce rôle.");
      return;
    }
    state.data = normalizeData(payload.data || state.data);
    if (state.serverRole) state.data.currentRole = state.serverRole;
    const messages = {
      "to-direction": "Demande transmise à la Direction.",
      modify: "Modification demandée.",
      refuse: "Demande refusée.",
      approve: "Congé validé et ticket généré si option activée.",
    };
    showToast(messages[action] || "Action enregistrée.");
    render();
    return;
  }
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
    leave.observations.push(`${currentRole()} : ${observation || "demande refusée."}`);
    leave.history.push(`${formatDate(toISO(today()))} : demande refusée.`);
    audit(currentRole(), `Demande de congé refusée pour ${fullName(employee)}.`);
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
  const leaveAvailable = Number(document.getElementById("empLeaveAvailable").value || 0);
  const leaveTaken = Number(document.getElementById("empLeaveTaken").value || 0);
  if (!firstName || !lastName || !matricule || !service || !fonction) {
    showToast("Merci de renseigner les champs principaux.");
    return;
  }
  const employee = {
    id: `emp-${Date.now()}`,
    matricule,
    firstName,
    lastName,
    hireDate: document.getElementById("empHireDate").value,
    birthDate: document.getElementById("empBirthDate").value,
    phone: document.getElementById("empPhone").value.trim(),
    email: document.getElementById("empEmail").value.trim(),
    cnpsNumber: document.getElementById("empCnps").value.trim(),
    service,
    direction,
    agency,
    fonction,
    maritalStatus: document.getElementById("empMaritalStatus").value.trim(),
    childrenCount: Number(document.getElementById("empChildrenCount").value || 0),
    departureDate: document.getElementById("empDepartureDate").value,
    status: document.getElementById("empDepartureDate").value ? "Sorti" : "Actif",
    leaveBalance: {
      initial: leaveAvailable + leaveTaken,
      acquired: 0,
      taken: leaveTaken,
      planned: 0,
      available: leaveAvailable,
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

function saveTemplate(event) {
  event.preventDefault();
  const type = document.getElementById("templateType").value;
  const content = document.getElementById("templateContent").value;
  state.data.documentTemplates[type] = content;
  audit("Admin RH", `Modèle '${type}' mis à jour.`);
  showToast("Modèle enregistré.");
  render();
}

function updateTemplateEditor() {
  const type = document.getElementById("templateType")?.value;
  const textarea = document.getElementById("templateContent");
  if (type && textarea) textarea.value = state.data.documentTemplates[type] || "";
}

function restoreTemplate() {
  const type = document.getElementById("templateType")?.value;
  if (!type) return;
  state.data.documentTemplates[type] = DEFAULT_DOCUMENT_TEMPLATES[type] || "";
  audit("Admin RH", `Modèle '${type}' remis par défaut.`);
  showToast("Modèle par défaut restauré.");
  render();
}

function parseNumberList(value) {
  return value.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)).sort((a, b) => b - a);
}

async function login(event) {
  event.preventDefault();
  const password = document.getElementById("loginPassword").value;
  const role = document.getElementById("loginRole").value;
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, role }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    showToast("Mot de passe incorrect.");
    return;
  }
  state.serverRole = payload.role || role;
  state.data.currentRole = state.serverRole;
  state.authenticated = true;
  state.employeePortal = { active: false, data: null };
  showToast(`Connexion réussie : ${state.serverRole}.`);
  await initApp();
}

async function employeeLogin(event) {
  event.preventDefault();
  if (!API_MODE) {
    showToast("Le portail salarié doit être utilisé en ligne ou via le serveur.");
    return;
  }
  const matricule = document.getElementById("employeeLoginMatricule").value.trim();
  const response = await fetch("/api/employee/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matricule }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    showToast("Matricule introuvable.");
    return;
  }
  state.employeePortal = { active: true, data: payload.data };
  showToast("Bienvenue dans ton espace salarié.");
  renderEmployeePortal();
}

async function employeeLogout() {
  await fetch("/api/employee/logout", { method: "POST", credentials: "same-origin" });
  state.employeePortal = { active: false, data: null };
  renderLogin();
}

function renderEmployeePortal() {
  setLoginMode(false);
  const portal = state.employeePortal.data;
  if (!portal?.employee) {
    renderLogin();
    return;
  }
  document.getElementById("roleSelect").value = "Collaborateur";
  const employee = portal.employee;
  const balance = employee.leaveBalance || {};
  const leaveRows = (portal.leaveRequests || []).map((leave) => `
    <tr>
      <td>${leave.type}</td>
      <td>${formatDate(leave.start)} → ${formatDate(leave.end)}<br><span class="muted">Reprise : ${formatDate(leave.returnDate)}</span></td>
      <td>${leave.days}</td>
      <td>${statusTag(leave.status)}</td>
      <td>${(leave.observations || []).slice(-1)[0] || "—"}</td>
    </tr>
  `).join("");
  const docRows = (portal.documentRequests || []).map((request) => `
    <tr>
      <td>${request.type}</td>
      <td>${formatDate(request.createdAt)}<br><span class="muted">${request.details || "—"}</span></td>
      <td>${statusTag(request.status)}</td>
      <td>${(request.history || []).slice(-1)[0] || "—"}</td>
    </tr>
  `).join("");

  document.getElementById("pageTitle").textContent = "Espace salarié";
  document.getElementById("appContent").innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Bienvenue ${fullName(employee)}</h3>
          <p>Matricule Zeus : <strong>${employee.matricule}</strong>. Tu peux envoyer une demande et suivre son avancement.</p>
        </div>
        <button class="ghost" data-action="employee-logout">Déconnexion</button>
      </div>
      <div class="grid three">
        ${kpiCard("Solde congé à date", `${balance.available ?? 0} j`, "Disponible")}
        ${kpiCard("Congés déjà pris", `${balance.taken ?? 0} j`, "Historique RH")}
        ${kpiCard("Demandes documents", (portal.documentRequests || []).length, "Total envoyé")}
      </div>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Demande de congé</h3>
          <p>La demande part à RH puis à la Direction selon le circuit de validation.</p>
        </div>
      </div>
      <form id="employeeLeaveForm" class="form-grid">
        <label><span>Type de congé</span><select id="employeeLeaveType"><option>Congé annuel</option><option>Congé exceptionnel</option><option>Congé maladie</option><option>Congé maternité</option><option>Autre</option></select></label>
        <label><span>Date de départ</span><input id="employeeLeaveStart" type="date" required></label>
        <label><span>Date de fin</span><input id="employeeLeaveEnd" type="date" required></label>
        <label class="full"><span>Motif / commentaire</span><textarea id="employeeLeaveComment"></textarea></label>
        <div class="toolbar full"><button class="primary" type="submit">Envoyer ma demande de congé</button></div>
      </form>
    </section>

    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Demande de document</h3>
          <p>Choisis le document souhaité. RH générera le document avec le modèle enregistré.</p>
        </div>
      </div>
      <form id="employeeDocumentForm" class="form-grid">
        <label><span>Document demandé</span><select id="employeeDocType">${DOCUMENT_TYPES.map((type) => `<option>${type}</option>`).join("")}</select></label>
        <label class="full"><span>Précision</span><textarea id="employeeDocDetails" placeholder="Ex : bulletin de juillet, banque, autre document à préciser..."></textarea></label>
        <div class="toolbar full"><button class="secondary" type="submit">Envoyer ma demande de document</button></div>
      </form>
    </section>

    <section class="panel">
      <div class="panel-header"><div><h3>Suivi de mes congés</h3></div></div>
      <div class="table-wrap">
        <table><thead><tr><th>Type</th><th>Période</th><th>Jours</th><th>Statut</th><th>Observation</th></tr></thead><tbody>${leaveRows || `<tr><td colspan="5">Aucune demande de congé.</td></tr>`}</tbody></table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-header"><div><h3>Suivi de mes documents</h3></div></div>
      <div class="table-wrap">
        <table><thead><tr><th>Document</th><th>Demande</th><th>Statut</th><th>Dernière étape</th></tr></thead><tbody>${docRows || `<tr><td colspan="4">Aucune demande de document.</td></tr>`}</tbody></table>
      </div>
    </section>
  `;
}

async function submitEmployeeLeave(event) {
  event.preventDefault();
  const response = await apiFetch("/api/employee/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: document.getElementById("employeeLeaveType").value,
      start: document.getElementById("employeeLeaveStart").value,
      end: document.getElementById("employeeLeaveEnd").value,
      comment: document.getElementById("employeeLeaveComment").value,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    showToast(payload.error || "Demande impossible.");
    return;
  }
  state.employeePortal.data = payload.data;
  showToast("Demande de congé envoyée.");
  renderEmployeePortal();
}

async function submitEmployeeDocument(event) {
  event.preventDefault();
  const response = await apiFetch("/api/employee/document-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: document.getElementById("employeeDocType").value,
      details: document.getElementById("employeeDocDetails").value,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    showToast(payload.error || "Demande impossible.");
    return;
  }
  state.employeePortal.data = payload.data;
  showToast("Demande de document envoyée.");
  renderEmployeePortal();
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  state.authenticated = false;
  state.apiReady = false;
  state.serverRole = "";
  state.employeePortal = { active: false, data: null };
  renderLogin();
}

async function exportData() {
  if (!API_MODE) {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
    downloadBlob(blob, `rh_control_export_${Date.now()}.json`);
    return;
  }
  const response = await apiFetch("/api/export");
  if (!response.ok) {
    showToast("Export impossible.");
    return;
  }
  const blob = await response.blob();
  downloadBlob(blob, `rh_control_export_${Date.now()}.json`);
}

async function backupDatabase() {
  if (!API_MODE) {
    showToast("Backup serveur disponible uniquement via le serveur.");
    return;
  }
  const response = await apiFetch("/api/backup", { method: "POST" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    showToast("Sauvegarde serveur impossible.");
    return;
  }
  showToast(payload.durable ? "Sauvegarde créée sur le disque serveur." : "Sauvegarde créée, mais le stockage Render reste temporaire.");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function importDataFile(file) {
  if (!file) return;
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    showToast("Fichier JSON invalide.");
    return;
  }
  if (!confirm("Importer ce fichier va remplacer les données actuellement enregistrées. Continuer ?")) return;
  if (!API_MODE) {
    state.data = normalizeData(data);
    saveState();
    render();
    showToast("Données importées dans le navigateur.");
    return;
  }
  const response = await apiFetch("/api/import", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    showToast("Import impossible.");
    return;
  }
  state.data = normalizeData(payload.data || data);
  render();
  showToast("Données importées dans la base.");
}

async function downloadEmployeeExcelTemplate() {
  if (!API_MODE) {
    showToast("Téléchargement disponible uniquement via le serveur.");
    return;
  }
  const response = await apiFetch("/api/employees/template");
  if (!response.ok) {
    showToast("Modèle Excel impossible à générer.");
    return;
  }
  const blob = await response.blob();
  downloadBlob(blob, "modele_import_collaborateurs.xlsx");
}

async function importEmployeeExcel(file) {
  if (!file) return;
  if (!API_MODE) {
    showToast("Import Excel disponible uniquement via le serveur.");
    return;
  }
  const form = new FormData();
  form.append("file", file);
  const response = await apiFetch("/api/employees/preview-excel", {
    method: "POST",
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    showToast(payload.error || "Lecture Excel impossible.");
    return;
  }
  pendingExcelFile = file;
  lastExcelPreview = payload;
  openExcelPreviewModal(payload);
}

function openExcelPreviewModal(payload) {
  const rows = payload.rows || [];
  const errorRows = rows.filter((row) => row.errors?.length);
  const visibleRows = rows.slice(0, 80);
  openModal(
    "Aperçu avant import Excel",
    `
      <div class="${errorRows.length ? "warning" : "success"}">
        ${errorRows.length
          ? `⚠ ${errorRows.length} ligne(s) à corriger avant import.`
          : "✅ Fichier prêt à importer dans la base."}
        <br>
        Créations : <strong>${payload.created || 0}</strong> · Mises à jour : <strong>${payload.updated || 0}</strong> · Ignorées : <strong>${payload.skipped || 0}</strong>
      </div>
      ${(payload.missingColumns || []).length ? `<div class="warning">Colonnes absentes du fichier : ${(payload.missingColumns || []).map(escapeHtml).join(", ")}</div>` : ""}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ligne</th><th>Matricule</th><th>Nom</th><th>Département</th><th>Action</th><th>Contrôle</th></tr></thead>
          <tbody>
            ${visibleRows.map((row) => `
              <tr>
                <td>${row.row}</td>
                <td>${escapeHtml(row.matricule || "—")}</td>
                <td>${escapeHtml(row.name || "—")}</td>
                <td>${escapeHtml(row.department || "—")}</td>
                <td>${tag(row.action || "—", row.action === "Erreur" ? "red" : row.action === "Mise à jour" ? "orange" : "green")}</td>
                <td>
                  ${(row.errors || []).map((item) => `<div class="tag red">${escapeHtml(item)}</div>`).join("")}
                  ${(row.warnings || []).map((item) => `<div class="tag orange">${escapeHtml(item)}</div>`).join("")}
                  ${!(row.errors || []).length && !(row.warnings || []).length ? `<span class="muted">OK</span>` : ""}
                </td>
              </tr>
            `).join("") || `<tr><td colspan="6">Aucune ligne détectée.</td></tr>`}
          </tbody>
        </table>
      </div>
      ${rows.length > visibleRows.length ? `<div class="hint">${rows.length - visibleRows.length} autre(s) ligne(s) non affichée(s) ici. Télécharge le rapport pour tout voir.</div>` : ""}
    `,
    `<button class="ghost" data-action="download-import-report">Télécharger le rapport</button>
     <button class="primary" data-action="confirm-excel-import" ${errorRows.length ? "disabled" : ""}>Confirmer l’import</button>
     <button class="ghost" data-action="close-modal">Fermer</button>`
  );
}

async function confirmEmployeeExcelImport() {
  if (!pendingExcelFile) {
    showToast("Choisis d’abord un fichier Excel.");
    return;
  }
  const form = new FormData();
  form.append("file", pendingExcelFile);
  const response = await apiFetch("/api/employees/import-excel", {
    method: "POST",
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    showToast(payload.error || "Import Excel impossible.");
    return;
  }
  state.data = normalizeData(payload.data || state.data);
  if (state.serverRole) state.data.currentRole = state.serverRole;
  pendingExcelFile = null;
  lastExcelPreview = payload.preview || lastExcelPreview;
  closeModal();
  showToast(`Import Excel terminé : ${payload.created} créé(s), ${payload.updated} mis à jour, ${payload.skipped} ignoré(s).`);
  render();
}

function downloadExcelPreviewReport() {
  if (!lastExcelPreview?.rows?.length) {
    showToast("Aucun rapport d’import disponible.");
    return;
  }
  const header = ["Ligne", "Matricule", "Nom", "Département", "Fonction", "Action", "Erreurs", "Avertissements"];
  const lines = [header, ...lastExcelPreview.rows.map((row) => [
    row.row,
    row.matricule || "",
    row.name || "",
    row.department || "",
    row.function || "",
    row.action || "",
    (row.errors || []).join(" | "),
    (row.warnings || []).join(" | "),
  ])];
  const csv = lines
    .map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";"))
    .join("\n");
  downloadBlob(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }), `rapport_import_excel_${Date.now()}.csv`);
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
  if (nav) {
    if (state.employeePortal.active) {
      showToast("Tu es dans l’espace salarié. Déconnecte-toi pour revenir à l’administration RH.");
      return;
    }
    setView(nav.dataset.view);
  }

  const go = event.target.closest("[data-go]");
  if (go) {
    if (state.employeePortal.active) {
      showToast("Action réservée à l’administration RH.");
      return;
    }
    setView(go.dataset.go);
  }

  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  const id = actionTarget.dataset.id;
  if (!canDo(action)) {
    showToast(`Action non autorisée pour le rôle : ${currentRole()}.`);
    return;
  }

  if (action === "close-modal") closeModal();
  if (action === "toggle-login-password") {
    const input = document.getElementById("loginPassword");
    if (input) {
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      actionTarget.textContent = visible ? "Voir" : "Cacher";
    }
  }
  if (action === "forgot-password") showToast("Contacte l’Admin RH pour réinitialiser ton accès.");
  if (action === "employee-file") employeeFile(id);
  if (action === "new-leave-for") {
    setView("leaves");
    setTimeout(() => {
      document.getElementById("leaveEmployee").value = id;
      updateLeavePreview();
    });
  }
  if (action === "add-employee") addEmployeeModal();
  if (action === "import-excel-modal") importExcelModal();
  if (action === "download-excel-template") downloadEmployeeExcelTemplate();
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
  if (action === "doc-request-details") viewDocumentRequest(id);
  if (action === "generate-doc-request") generateDocumentRequest(id);
  if (action === "download-doc-request") downloadDocumentRequest(id, actionTarget.dataset.format || "docx");
  if (action === "transmit-doc-request") transmitDocumentRequest(id);
  if (action === "refuse-doc-request") refuseDocumentRequest(id);
  if (action === "confirm-excel-import") confirmEmployeeExcelImport();
  if (action === "download-import-report") downloadExcelPreviewReport();
  if (action === "restore-template") restoreTemplate();
  if (action === "export-data") exportData();
  if (action === "backup-db") backupDatabase();
  if (action === "logout") logout();
  if (action === "employee-logout") employeeLogout();
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
  if (event.target.id === "loginForm") login(event);
  if (event.target.id === "employeeLoginForm") employeeLogin(event);
  if (event.target.id === "employeeLeaveForm") submitEmployeeLeave(event);
  if (event.target.id === "employeeDocumentForm") submitEmployeeDocument(event);
  if (event.target.id === "leaveForm") {
    if (!canDo("create-leave")) {
      event.preventDefault();
      showToast(`Création de congé non autorisée pour le rôle : ${currentRole()}.`);
      return;
    }
    createLeave(event);
  }
  if (event.target.id === "documentRequestForm") {
    if (!canDo("create-document-request")) {
      event.preventDefault();
      showToast(`Création de document non autorisée pour le rôle : ${currentRole()}.`);
      return;
    }
    createDocumentRequest(event);
  }
  if (event.target.id === "settingsForm") {
    if (currentRole() !== "Admin RH") {
      event.preventDefault();
      showToast("Paramétrage réservé à l’Admin RH.");
      return;
    }
    saveSettings(event);
  }
  if (event.target.id === "templateForm") {
    if (currentRole() !== "Admin RH") {
      event.preventDefault();
      showToast("Modèles réservés à l’Admin RH.");
      return;
    }
    saveTemplate(event);
  }
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
  if (event.target.id === "importDataFile") {
    if (!canDo("import-data")) {
      showToast("Import JSON réservé à l’Admin RH.");
      event.target.value = "";
      return;
    }
    importDataFile(event.target.files?.[0]);
    event.target.value = "";
  }
  if (event.target.id === "employeeExcelFile") {
    if (!canDo("import-excel-modal")) {
      showToast(`Import Excel non autorisé pour le rôle : ${currentRole()}.`);
      event.target.value = "";
      return;
    }
    importEmployeeExcel(event.target.files?.[0]);
    event.target.value = "";
  }
  if (event.target.id === "templateType") {
    updateTemplateEditor();
  }
});

document.getElementById("roleSelect").addEventListener("change", (event) => {
  if (state.employeePortal.active) {
    event.target.value = "Collaborateur";
    showToast("Rôle bloqué dans l’espace salarié.");
    return;
  }
  if (state.serverRole) {
    event.target.value = state.serverRole;
    showToast(`Rôle verrouillé par la session : ${state.serverRole}.`);
    return;
  }
  state.data.currentRole = event.target.value;
  if (!canView(state.view, event.target.value)) {
    state.view = firstAllowedView(event.target.value);
  }
  showToast(`Rôle actif : ${event.target.value}`);
  render();
});

document.getElementById("globalSearch").addEventListener("input", (event) => {
  if (state.employeePortal.active) {
    event.target.value = "";
    return;
  }
  state.search = event.target.value;
  render();
});

document.getElementById("resetDemo").addEventListener("click", () => {
  if (state.employeePortal.active) {
    showToast("Réinitialisation réservée à l’administration RH.");
    return;
  }
  if (currentRole() !== "Admin RH") {
    showToast("Réinitialisation réservée à l’Admin RH.");
    return;
  }
  if (!confirm("Réinitialiser toutes les données de l'application ?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state.data = defaultState();
  state.view = "dashboard";
  setView("dashboard");
  showToast(API_MODE ? "Base de données réinitialisée." : "Stockage navigateur réinitialisé.");
});

initApp();
