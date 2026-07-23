/* ============================================================
   The Creative Companion — shared functional layer (Phase 1)
   ------------------------------------------------------------
   Interim, front-end-only prototype. Everything here is designed
   to be REPLACED by the real backend on GCP (see docs/DEV-HANDOFF.md):
     - The passcode gate  -> Supabase/IAP Google auth (@idesignedu.org)
     - localStorage stores -> Postgres tables (updates, notes, roles)
     - The embedded WORKLOAD snapshot -> live Asana pull via a
       Cloud Function using a service token in Secret Manager.

   No data leaves the browser. Nothing is sent to any server.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Interim access gate ----------------------------------------
     SOFT gate only: this keeps the prototype off the open web for the
     interim. It is NOT real authentication — the passcode lives in client
     code. Real per-person auth is a dev/GCP task. Change here + share the
     passcode out-of-band with the team.                                    */
  var CC_PASSCODE = 'creative-companion';           // (legacy team gate — gate removed)
  var CC_ADMIN_PASSCODE = 'creative-admin';          // unlock editing (admin role). Interim soft lock.
  var CC_AUTH_KEY = 'cc-auth-v1';                    // sessionStorage flag
  var CC_ROLE_KEY = 'cc-role-v1';                    // localStorage: 'admin' | 'member'
  var CC_UPDATES_KEY = 'cc-updates-v1';              // localStorage: paste-inbox items
  var CC_EDIT_KEY = 'cc-editmode-v1';

  /* ---------- Partner registry ------------------------------------------
     Org-level only (no person PII). `page` links to a Living Project Page
     when one exists; grandfathered partners are page-less. `source` is the
     PBD / Drive source-of-truth link that holds the full contact detail in
     the access-controlled Google workspace (not duplicated into the app).  */
  var PARTNERS = [
    { slug: 'UCF',       name: 'UCF',        page: 'Projects/UCF.html' },
    { slug: 'EMU',       name: 'EMU',        page: 'Projects/EMU.html' },
    { slug: 'Alvernia',  name: 'Alvernia',   page: 'Projects/Alvernia.html' },
    { slug: 'UT_Austin', name: 'UT Austin',  page: 'Projects/UT_Austin.html' },
    { slug: 'FullBloom', name: 'FullBloom',  page: 'Projects/FullBloom.html' },
    { slug: 'Salve',     name: 'Salve Regina', page: null },
    { slug: 'Iona',      name: 'Iona',       page: null },
    { slug: 'Utah',      name: 'Utah',       page: null },
    { slug: 'UA_PTC',    name: 'UA – PTC',   page: null },
    { slug: 'Tulane',    name: 'Tulane',     page: null },
    { slug: 'General',   name: 'General / unassigned', page: null }
  ];

  /* ---------- Asana workload snapshot ------------------------------------
     READ-ONLY snapshot of "Creative Requests · Design + Dev"
     (project 1204155587372960). Rolled up by partner from the 79 open
     tasks. No token is embedded. Refresh: re-pull + redeploy (interim),
     or a scheduled Cloud Function on GCP (see DEV-HANDOFF.md).             */
  var WORKLOAD = {
    syncedAt: '2026-07-22',
    board: 'Creative Requests · Design + Dev',
    asanaUrl: 'https://app.asana.com/0/1204155587372960/list',
    partners: [
      { name: 'Salve Regina', slug: 'Salve', open: 54, split: { 'Unassigned': 51, 'Assigned': 3 }, nextDue: '2026-07-29', overdue: 0 },
      { name: 'Iona',         slug: 'Iona',  open: 9,  split: { 'Unassigned': 9 }, nextDue: null, overdue: 0 },
      { name: 'Utah',         slug: 'Utah',  open: 7,  split: { 'Requester Review': 5, 'In Progress': 1, 'To-Dos requested': 1 }, nextDue: '2026-07-20', overdue: 2, waiting: true, overdueReason: 'In partner review (Requester Review) — awaiting partner approval' },
      { name: 'UA – PTC',     slug: 'UA_PTC', open: 4, split: { 'Creative Review': 3, 'Assigned': 1 }, nextDue: '2026-06-12', overdue: 3, waiting: true, overdueReason: 'In Creative Review — awaiting reviewer sign-off' },
      { name: 'UCF',          slug: 'UCF',   open: 2,  split: { 'Assigned': 2 }, nextDue: '2026-08-12', overdue: 0 },
      { name: 'Tulane',       slug: 'Tulane', open: 1, split: { 'Requester Review': 1 }, nextDue: '2026-04-27', overdue: 1, waiting: true, overdueReason: 'In partner review — awaiting partner approval' }
    ]
  };

  var TODAY = '2026-07-22';

  /* ---------- small helpers --------------------------------------------- */
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function root() { return (document.body.getAttribute('data-cc-root') || ''); }
  function partnerName(slug) { for (var i = 0; i < PARTNERS.length; i++) if (PARTNERS[i].slug === slug) return PARTNERS[i].name; return slug; }

  function readUpdates() { try { return JSON.parse(localStorage.getItem(CC_UPDATES_KEY) || '[]'); } catch (e) { return []; } }
  function writeUpdates(a) { try { localStorage.setItem(CC_UPDATES_KEY, JSON.stringify(a)); } catch (e) {} }
  function getRole() { try { return localStorage.getItem(CC_ROLE_KEY) || 'member'; } catch (e) { return 'member'; } }
  function setRole(r) { try { localStorage.setItem(CC_ROLE_KEY, r); } catch (e) {} }
  function isEditing() { try { return localStorage.getItem(CC_EDIT_KEY) === 'on'; } catch (e) { return false; } }

  /* =======================================================================
     1. ACCESS GATE
     ===================================================================== */
  function authed() { try { return sessionStorage.getItem(CC_AUTH_KEY) === 'ok'; } catch (e) { return false; } }

  function buildGate() {
    document.documentElement.classList.add('cc-locked');
    var gate = el('div', 'cc-gate');
    gate.innerHTML =
      '<div class="cc-gate-card">' +
        '<div class="cc-gate-brand"><img class="cc-gate-logo" src="Studio-logo-white.svg" alt="iDesign Studio">' +
        '<span class="cc-gate-word">Creative Companion</span></div>' +
        '<h2>Team access</h2>' +
        '<p>This is the Creative team\'s internal source of truth. Enter the shared team passcode to continue.</p>' +
        '<label for="cc-gate-input">Passcode</label>' +
        '<input id="cc-gate-input" type="password" autocomplete="off" autofocus />' +
        '<button id="cc-gate-go">Enter</button>' +
        '<div class="cc-gate-error" id="cc-gate-error"></div>' +
        '<div class="cc-gate-note">Interim access only. This soft gate keeps the prototype off the open web while it is tested. ' +
        'The production version on Google Cloud will use per-person iDesign sign-in and admin roles — no shared passcode.</div>' +
      '</div>';
    document.body.appendChild(gate);
    var input = gate.querySelector('#cc-gate-input');
    var err = gate.querySelector('#cc-gate-error');
    function attempt() {
      if (input.value.trim() === CC_PASSCODE) {
        try { sessionStorage.setItem(CC_AUTH_KEY, 'ok'); } catch (e) {}
        document.documentElement.classList.remove('cc-locked');
        gate.remove();
        boot();
      } else {
        err.textContent = 'That passcode is not recognized.';
        input.select();
      }
    }
    gate.querySelector('#cc-gate-go').addEventListener('click', attempt);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') attempt(); });
  }

  /* =======================================================================
     2. ADMIN / ROLE BAR
     ===================================================================== */
  function buildAdminBar() {
    if (document.querySelector('.cc-navctrls')) return;
    var role = getRole();
    // Fold controls into GDM's existing top nav — no separate bar, her design is untouched.
    var host = document.querySelector('.topnav-inner');
    if (!host) return;
    var bar = el('span', 'cc-navctrls');
    bar.innerHTML =
      '<span class="cc-role-toggle" id="cc-role">' +
        '<button data-role="admin">Admin</button><button data-role="member">Member</button>' +
      '</span>' +
      '<button class="cc-editmode-btn" id="cc-editmode">Edit: off</button>' +
      '<span class="cc-signout" id="cc-signout">Sign out</span>';
    host.appendChild(bar);

    function paint() {
      role = getRole();
      bar.querySelectorAll('#cc-role button').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-role') === role);
      });
      var eb = bar.querySelector('#cc-editmode');
      var canEdit = role === 'admin';
      eb.style.display = canEdit ? '' : 'none';
      var on = canEdit && isEditing();
      eb.classList.toggle('on', on);
      eb.textContent = 'Edit mode: ' + (on ? 'ON' : 'off');
      document.documentElement.classList.toggle('cc-editing', on);
      applyEditable(on);
    }
    bar.querySelectorAll('#cc-role button').forEach(function (b) {
      b.addEventListener('click', function () {
        var want = b.getAttribute('data-role');
        // Admin is the lock: unlocking editing requires the admin passcode.
        if (want === 'admin' && getRole() !== 'admin') {
          var pw = prompt('Enter the admin passcode to unlock editing:');
          if (pw === null) return;
          if (pw !== CC_ADMIN_PASSCODE) { alert('Incorrect passcode — staying in view-only (Member).'); return; }
        }
        setRole(want);
        if (getRole() !== 'admin') { try { localStorage.setItem(CC_EDIT_KEY, 'off'); } catch (e) {} }
        paint(); renderInbox(); // re-render inbox actions for role
      });
    });
    bar.querySelector('#cc-editmode').addEventListener('click', function () {
      try { localStorage.setItem(CC_EDIT_KEY, isEditing() ? 'off' : 'on'); } catch (e) {}
      paint();
    });
    bar.querySelector('#cc-signout').addEventListener('click', function () {
      // "Sign out" = drop admin, return to view-only (no gate to sign out of anymore)
      try { setRole('member'); localStorage.setItem(CC_EDIT_KEY, 'off'); sessionStorage.removeItem(CC_AUTH_KEY); } catch (e) {}
      location.reload();
    });
    paint();
  }

  /* Admin inline edit: any [data-cc-editable="key"] becomes editable in
     edit mode; text persists to localStorage under cc-edit:<key>.         */
  function applyEditable(on) {
    var nodes = document.querySelectorAll('[data-cc-editable]');
    nodes.forEach(function (n) {
      var key = 'cc-edit:' + n.getAttribute('data-cc-editable');
      try { var saved = localStorage.getItem(key); if (saved != null) n.textContent = saved; } catch (e) {}
      n.setAttribute('contenteditable', on ? 'true' : 'false');
      if (on && !n._ccBound) {
        n._ccBound = true;
        n.addEventListener('blur', function () {
          try { localStorage.setItem(key, n.textContent); } catch (e) {}
          n.classList.add('cc-edit-flash'); setTimeout(function () { n.classList.remove('cc-edit-flash'); }, 600);
        });
      }
    });
  }

  /* =======================================================================
     3. UPDATE INBOX  (paste-to-update)
     ===================================================================== */
  var inboxFilter = 'all';

  var KINDS = {
    resolved: { label: 'Resolved', cls: 'k-ok' },
    blocker:  { label: 'Blocker / risk', cls: 'k-warn' },
    deadline: { label: 'Date', cls: 'k-info' },
    status:   { label: 'Status / phase', cls: 'k-info' },
    contact:  { label: 'Contact', cls: 'k-info' },
    note:     { label: 'Note', cls: 'k-note' }
  };

  // Interim heuristic parser. Production (GCP) swaps this for an AI call that
  // also diffs against the partner's structured state. The review/apply UX is identical.
  function analyzeUpdate(text) {
    var chunks = text.split(/[\n]+|(?<=[.!?])\s+/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 8; });
    if (!chunks.length) chunks = [text.trim()];
    var props = [];
    chunks.forEach(function (s) {
      var l = s.toLowerCase(), kind = null;
      if (/(resolved|unblocked|cleared|now confirmed|confirmed|signed|approved|received|granted|sorted|locked in)/.test(l) &&
          /(blocker|hour|tick|budget|scope|contact|access|signature|contract|brand|allocation|deadline)/.test(l)) kind = 'resolved';
      else if (/(blocker|blocked|escalat|at risk|waiting on|still pending|missing|cannot|can.?t|not allocated|no (creative )?(hours|contact|access|brand))/.test(l)) kind = 'blocker';
      else if (/\b\d{1,2}\/\d{1,2}\b/.test(s) || /(deadline|due date|due by|launch|go.?live|kick.?off|target date|by (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/.test(l)) kind = 'deadline';
      else if (/(phase|cycle|in review|in progress|delivered|published|program planning|design (and|&) (delivery|development)|\bd&d\b|pre.?kickoff)/.test(l)) kind = 'status';
      else if (/[A-Z][a-z]+ [A-Z]\b/.test(s) && /(contact|\bsme\b|lead|director|provost|dean|manager|point of contact|\bpoc\b|stakeholder|champion)/.test(l)) kind = 'contact';
      if (kind) props.push({ kind: kind, text: s, accept: true, applied: false });
    });
    var seen = {}; props = props.filter(function (p) { var k = p.kind + '|' + p.text; if (seen[k]) return false; seen[k] = 1; return true; });
    props.push({ kind: 'note', text: 'Add the full update as an activity note', accept: props.length === 0, applied: false, isNote: true });
    return props;
  }

  function addUpdate(partner, type, text) {
    var list = readUpdates();
    list.unshift({
      id: 'u-' + TODAY + '-' + list.length + '-' + text.length,
      partner: partner, type: type, text: text,
      author: 'Creative team', created: TODAY, status: 'new',
      proposals: analyzeUpdate(text)
    });
    writeUpdates(list);
  }
  function setProposal(id, idx, field, val) {
    var list = readUpdates();
    for (var i = 0; i < list.length; i++) if (list[i].id === id && list[i].proposals && list[i].proposals[idx]) list[i].proposals[idx][field] = val;
    writeUpdates(list);
  }
  function applyUpdate(id) {
    var list = readUpdates(), n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) {
      (list[i].proposals || []).forEach(function (p) { if (p.accept) { p.applied = true; n++; } });
      if (n) list[i].status = 'applied';
    }
    writeUpdates(list);
    return n;
  }
  function setUpdateStatus(id, status) {
    var list = readUpdates();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) list[i].status = status;
    writeUpdates(list);
  }
  function deleteUpdate(id) { writeUpdates(readUpdates().filter(function (u) { return u.id !== id; })); }

  function buildInboxForm() {
    var host = document.getElementById('cc-inbox-form');
    if (!host) return;
    var opts = PARTNERS.map(function (p) { return '<option value="' + p.slug + '">' + esc(p.name) + '</option>'; }).join('');
    host.innerHTML =
      '<h4>+ New update</h4>' +
      '<div class="cc-field"><label>Paste content</label>' +
        '<textarea id="cc-in-text" placeholder="Paste a Fathom transcript, a Slack thread, a Project Brief excerpt, or a quick note…"></textarea></div>' +
      '<div class="cc-field"><label>Tag a partner</label><select id="cc-in-partner">' + opts + '</select></div>' +
      '<div class="cc-field"><label>Type</label><select id="cc-in-type">' +
        '<option value="note">Quick note</option><option value="transcript">Fathom transcript</option>' +
        '<option value="slack">Slack thread</option><option value="brief">Project brief</option></select></div>' +
      '<button class="cc-btn cc-btn-primary" id="cc-in-submit" style="width:100%">Analyze &amp; review changes</button>' +
      '<p class="cc-inbox-hint">Paste &rarr; the Companion reads it and <b>proposes specific changes</b> to the partner page &rarr; you accept, edit, or dismiss each one &rarr; approved changes apply to the page and log with their source. Nothing auto-applies. ' +
      '<i>Interim: a lightweight local parser; the GCP build swaps in AI parsing that also diffs against the page&rsquo;s current state.</i></p>';
    host.querySelector('#cc-in-submit').addEventListener('click', function () {
      var t = host.querySelector('#cc-in-text');
      var txt = t.value.trim();
      if (!txt) { t.focus(); return; }
      addUpdate(host.querySelector('#cc-in-partner').value, host.querySelector('#cc-in-type').value, txt);
      t.value = '';
      renderInbox();
    });
  }

  var TYPE_LABEL = { note: 'Quick note', transcript: 'Fathom transcript', slack: 'Slack thread', brief: 'Project brief' };

  function renderInbox() {
    var host = document.getElementById('cc-inbox-list');
    if (!host) return;
    var role = getRole();
    var all = readUpdates();
    var items = all.filter(function (u) { return inboxFilter === 'all' ? u.status !== 'archived' : u.status === inboxFilter; });

    var filters = ['all', 'new', 'reviewed', 'applied', 'archived'];
    var fhtml = '<div class="cc-inbox-filters">' + filters.map(function (f) {
      var count = f === 'all' ? all.filter(function (u) { return u.status !== 'archived'; }).length : all.filter(function (u) { return u.status === f; }).length;
      return '<button data-f="' + f + '" class="' + (inboxFilter === f ? 'active' : '') + '">' + f + ' (' + count + ')</button>';
    }).join('') + '</div>';

    var isAdmin = role === 'admin';
    var body;
    if (!items.length) {
      body = '<div class="cc-empty">Nothing here yet. Paste an update on the left and click <b>Analyze &amp; review changes</b> — proposed edits to the partner page appear here for you to accept, edit, or dismiss.</div>';
    } else {
      body = items.map(function (u) {
        var pmatch = null; for (var i = 0; i < PARTNERS.length; i++) if (PARTNERS[i].slug === u.partner) pmatch = PARTNERS[i];
        var pageLink = (pmatch && pmatch.page) ? ' · <a href="' + root() + pmatch.page + '">open page →</a>' : '';
        var props = u.proposals || [];
        var nAccept = props.filter(function (p) { return p.accept && !p.applied; }).length;
        var nApplied = props.filter(function (p) { return p.applied; }).length;

        var propHtml = props.map(function (p, idx) {
          var k = KINDS[p.kind] || KINDS.note;
          if (p.applied) {
            return '<div class="cc-prop"><span class="cc-prop-kind ' + k.cls + '">' + k.label + '</span>' +
              '<div class="cc-prop-text ro">' + esc(p.text) + '</div><span class="cc-prop-done">✓ applied</span></div>';
          }
          return '<div class="cc-prop">' +
            '<input type="checkbox" data-id="' + u.id + '" data-idx="' + idx + '" ' + (p.accept ? 'checked' : '') + (isAdmin ? '' : ' disabled') + '>' +
            '<span class="cc-prop-kind ' + k.cls + '">' + k.label + '</span>' +
            '<textarea class="cc-prop-text" rows="2" data-id="' + u.id + '" data-idx="' + idx + '"' + (isAdmin ? '' : ' readonly') + '>' + esc(p.text) + '</textarea>' +
          '</div>';
        }).join('');

        var actions = '';
        if (isAdmin) {
          if (u.status !== 'applied' && nAccept) actions += '<button data-act="apply" data-id="' + u.id + '">Apply ' + nAccept + ' change' + (nAccept > 1 ? 's' : '') + ' to page →</button>';
          if (u.status === 'new') actions += '<button data-act="reviewed" data-id="' + u.id + '">Mark reviewed</button>';
          actions += '<button data-act="archived" data-id="' + u.id + '">Archive</button>';
          actions += '<button class="danger" data-act="delete" data-id="' + u.id + '">Delete</button>';
        }

        return '<div class="cc-update-card status-' + u.status + '">' +
          '<div class="cc-update-head">' +
            '<span class="cc-update-partner">' + esc(partnerName(u.partner)) + '</span>' +
            '<span class="cc-update-type">' + esc(TYPE_LABEL[u.type] || u.type) + '</span>' +
            '<span class="cc-pill cc-pill-' + u.status + '">' + u.status + '</span>' +
            '<span class="cc-update-meta">' + esc(u.created) + pageLink + '</span>' +
          '</div>' +
          '<div class="cc-prop-head">Proposed changes to ' + esc(partnerName(u.partner)) + '&rsquo;s page' + (nApplied ? ' · ' + nApplied + ' applied' : '') + '</div>' +
          propHtml +
          '<details class="cc-raw"><summary>View pasted source</summary><div class="cc-update-text">' + esc(u.text) + '</div></details>' +
          (actions ? '<div class="cc-update-actions">' + actions + '</div>' : '') +
        '</div>';
      }).join('');
    }
    host.innerHTML = fhtml + body;

    host.querySelectorAll('.cc-inbox-filters button').forEach(function (b) {
      b.addEventListener('click', function () { inboxFilter = b.getAttribute('data-f'); renderInbox(); });
    });
    host.querySelectorAll('.cc-prop input[type=checkbox]').forEach(function (c) {
      c.addEventListener('change', function () { setProposal(c.getAttribute('data-id'), +c.getAttribute('data-idx'), 'accept', c.checked); renderInbox(); });
    });
    host.querySelectorAll('textarea.cc-prop-text').forEach(function (t) {
      t.addEventListener('input', function () { setProposal(t.getAttribute('data-id'), +t.getAttribute('data-idx'), 'text', t.value); });
    });
    host.querySelectorAll('.cc-update-actions button').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id'), act = b.getAttribute('data-act');
        if (act === 'delete') { if (confirm('Delete this update permanently?')) deleteUpdate(id); }
        else if (act === 'apply') { applyUpdate(id); }
        else setUpdateStatus(id, act);
        renderInbox(); renderPartnerFeed();
      });
    });
  }

  /* =======================================================================
     4. WORKLOAD DASHBOARD
     ===================================================================== */
  function overdueLabel(due) {
    if (!due) return '<span class="cc-wl-none">—</span>';
    var over = due < TODAY;
    return '<span class="' + (over ? 'cc-wl-overdue' : '') + '">' + esc(due) + (over ? ' · overdue' : '') + '</span>';
  }
  function renderWorkload() {
    var host = document.getElementById('cc-workload');
    if (!host) return;
    var rows = WORKLOAD.partners.slice().sort(function (a, b) { return b.open - a.open; }).map(function (p) {
      var reg = null; for (var i = 0; i < PARTNERS.length; i++) if (PARTNERS[i].slug === p.slug) reg = PARTNERS[i];
      var page = (reg && reg.page)
        ? '<a class="cc-wl-haspage" href="' + root() + reg.page + '">Open page →</a>'
        : '<span class="cc-wl-nopage">No page (grandfathered)</span>';
      var split = Object.keys(p.split).map(function (k) { return '<span class="seg">' + esc(k) + ': <strong>' + p.split[k] + '</strong></span>'; }).join(' · ');
      return '<tr>' +
        '<td><span class="cc-wl-partner">' + esc(p.name) + '</span></td>' +
        '<td class="num"><span class="cc-wl-open">' + p.open + '</span></td>' +
        '<td><span class="cc-wl-split">' + split + '</span></td>' +
        '<td>' + overdueLabel(p.nextDue) + '</td>' +
        '<td>' + (p.overdue > 0
          ? '<span class="cc-pill ' + (p.waiting ? 'cc-pill-warn' : 'cc-pill-over') + '">' + p.overdue + (p.waiting ? ' awaiting approval' : ' overdue') + '</span>'
            + (p.overdueReason ? '<div class="cc-wl-reason">' + (p.waiting ? 'past due · ' : '') + esc(p.overdueReason) + '</div>' : '')
          : '<span class="cc-wl-none">on track</span>') + '</td>' +
        '<td>' + page + '</td>' +
      '</tr>';
    }).join('');
    var total = WORKLOAD.partners.reduce(function (s, p) { return s + p.open; }, 0);
    host.innerHTML =
      '<div class="cc-wl-synced">Read-only snapshot of <span class="accent">' + esc(WORKLOAD.board) + '</span> · ' +
        total + ' open requests across ' + WORKLOAD.partners.length + ' partners · ' +
        'synced <span class="accent">' + esc(WORKLOAD.syncedAt) + '</span> · ' +
        '<a href="' + WORKLOAD.asanaUrl + '" target="_blank" rel="noopener">open board in Asana →</a></div>' +
      '<table class="cc-wl-table"><thead><tr>' +
        '<th>Partner</th><th class="num">Open</th><th>Status split</th><th>Next deadline</th><th>Overdue &amp; why</th><th>Living page</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="cc-inbox-hint" style="margin-top:14px"><b style="color:var(--cc-sub,#B3D9E7)">Reading “overdue”:</b> items sitting in a <b>review</b> status are <b>awaiting a sign-off</b> (partner or reviewer) — waiting on them, not stalled on Creative — shown amber. A true red “overdue” means Creative work has slipped. Reasons are derived from each task’s Asana status; the live pull confirms per task.</p>' +
      '<p class="cc-inbox-hint" style="margin-top:8px">Snapshot only — refreshed by re-pulling the board (interim) or a scheduled Cloud Function on GCP. No Asana token is stored in this file.</p>';
  }

  /* =======================================================================
     5. PARTNER-PAGE activity feed  (applied inbox updates surface here)
     ===================================================================== */
  function renderPartnerFeed() {
    var host = document.getElementById('cc-partner-feed');
    if (!host) return;
    var slug = document.body.getAttribute('data-cc-partner');
    var updates = readUpdates().filter(function (u) { return u.partner === slug && u.status === 'applied'; });
    // flatten to the individual applied changes (structured, traceable)
    var changes = [];
    updates.forEach(function (u) {
      (u.proposals || []).forEach(function (p) {
        if (p.applied) changes.push({ kind: p.kind, text: p.text, created: u.created, type: u.type });
      });
    });
    if (!changes.length) {
      host.innerHTML = '<div class="cc-empty" style="padding:20px">No applied updates yet. In the Update Inbox, analyze a pasted update and apply the changes you approve — they log here with their source.</div>';
      return;
    }
    host.innerHTML = changes.map(function (c) {
      var k = KINDS[c.kind] || KINDS.note;
      return '<div class="cc-feed-item">' +
        '<div class="cc-feed-date"><span class="cc-prop-kind ' + k.cls + '">' + k.label + '</span> ' + esc(c.created) +
          ' <span class="cc-feed-source">from ' + esc(TYPE_LABEL[c.type] || c.type) + ' · Update Inbox</span></div>' +
        '<div class="cc-feed-text">' + esc(c.text) + '</div></div>';
    }).join('');
  }

  /* =======================================================================
     BOOT
     ===================================================================== */
  function boot() {
    buildAdminBar();
    buildInboxForm();
    renderInbox();
    renderWorkload();
    renderPartnerFeed();
    applyEditable(getRole() === 'admin' && isEditing());
    // Re-render inbox/workload when the index tab is switched (links use showSection)
    if (typeof window.showSection === 'function' && !window._ccWrapped) {
      window._ccWrapped = true;
      var orig = window.showSection;
      window.showSection = function (n) { orig(n); if (n === 'inbox') renderInbox(); if (n === 'workload') renderWorkload(); };
    }
  }

  // Gate removed — access is fronted by the Studio hub passcode; CC opens directly,
  // with editing still admin-locked (like the Review tool). To re-enable a standalone
  // gate, restore: if (authed()) boot(); else buildGate();
  function start() { boot(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
