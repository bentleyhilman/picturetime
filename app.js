
(() => {
  "use strict";

  const STORAGE_KEY = "pictureTime_v1";
  const PHOTO_DB = "pictureTimePhotos_v1";
  const ROUND_MS = 15 * 60 * 1000;
  const $ = id => document.getElementById(id);

  let state = loadState();
  let toastTimer;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.groups) && Array.isArray(saved.rounds)) {
        return saved;
      }
    } catch (error) {
      console.warn("Could not load saved data", error);
    }
    return { name: "Bentley", currentGroupId: null, groups: [], rounds: [] };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function makeId() {
    return crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function makeCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes, b => chars[b % chars.length]).join("");
  }

  function currentGroup() {
    return state.groups.find(g => g.id === state.currentGroupId) || null;
  }

  function activeRound(groupId) {
    return state.rounds.find(r =>
      r.groupId === groupId && r.active && Date.now() < r.endsAt
    ) || null;
  }

  function expireRounds() {
    let changed = false;
    state.rounds.forEach(round => {
      if (round.active && Date.now() >= round.endsAt) {
        round.active = false;
        changed = true;
      }
    });
    if (changed) saveState();
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit"
    });
  }

  function toast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2800);
  }

  function openModal(id) {
    const dialog = $(id);
    if (dialog && !dialog.open) dialog.showModal();
  }

  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => $(button.dataset.close).close());
  });

  document.querySelectorAll("dialog").forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });

  // Photo files are stored separately in IndexedDB so they aren't crammed
  // into localStorage, which has a much smaller storage limit.
  function openPhotoDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PHOTO_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("photos")) {
          db.createObjectStore("photos", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function savePhoto(photo) {
    const db = await openPhotoDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readwrite");
      tx.objectStore("photos").put(photo);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function photosForRound(roundId) {
    const db = await openPhotoDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("photos", "readonly");
      const request = tx.objectStore("photos").getAll();
      request.onsuccess = () => {
        db.close();
        resolve(request.result
          .filter(photo => photo.roundId === roundId)
          .sort((a, b) => a.createdAt - b.createdAt));
      };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }

  function renderGroups() {
    const select = $("groupSelect");
    select.replaceChildren();

    if (!state.groups.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No groups yet";
      select.append(option);
      select.disabled = true;
    } else {
      select.disabled = false;
      state.groups.forEach(group => {
        const option = document.createElement("option");
        option.value = group.id;
        option.textContent = group.name;
        option.selected = group.id === state.currentGroupId;
        select.append(option);
      });
    }

    $("groupsList").replaceChildren();

    if (!state.groups.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "No groups yet. Make your first one above.";
      $("groupsList").append(message);
      return;
    }

    state.groups.forEach(group => {
      const row = document.createElement("div");
      row.className = "group-row";

      const info = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = group.name;
      const code = document.createElement("small");
      code.textContent = "INVITE CODE · " + group.code;
      info.append(name, code);

      const actions = document.createElement("div");
      actions.className = "group-actions";

      const copy = document.createElement("button");
      copy.className = "copy-button";
      copy.textContent = "Copy code";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(group.code);
          toast("Invite code copied!");
        } catch {
          toast("Invite code: " + group.code);
        }
      });

      const open = document.createElement("button");
      open.className = "copy-button";
      open.textContent = group.id === state.currentGroupId ? "Selected" : "Open";
      open.addEventListener("click", () => {
        state.currentGroupId = group.id;
        saveState();
        renderAll();
        toast("Opened " + group.name);
      });

      actions.append(copy, open);
      row.append(info, actions);
      $("groupsList").append(row);
    });
  }

  function photoTile(photo) {
    const figure = document.createElement("figure");
    figure.className = "photo-tile";

    const img = document.createElement("img");
    img.alt = "Photo shared by " + photo.name;
    img.loading = "lazy";
    const url = URL.createObjectURL(photo.blob);
    img.src = url;
    img.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });

    const caption = document.createElement("figcaption");
    caption.textContent = photo.name || "A friend";
    figure.append(img, caption);
    return figure;
  }

  async function renderActiveRound() {
    expireRounds();
    const group = currentGroup();
    const round = group ? activeRound(group.id) : null;
    const section = $("activeRound");

    if (!round) {
      section.classList.add("hidden");
      return;
    }

    section.classList.remove("hidden");
    const remaining = Math.max(0, round.endsAt - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    $("timer").textContent =
      String(minutes).padStart(2, "0") + ":" +
      String(seconds).padStart(2, "0");

    const host = $("activePhotos");
    host.replaceChildren();

    const photos = await photosForRound(round.id);
    if (!photos.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "No photos yet. Be the first to add one!";
      host.append(message);
    } else {
      photos.forEach(photo => host.append(photoTile(photo)));
    }
  }

  async function openRound(round) {
    const photos = await photosForRound(round.id);
    $("roundDate").textContent = formatDate(round.startedAt).toUpperCase();
    $("roundTitle").textContent = round.title || "Picture time!";
    const host = $("roundPhotos");
    host.replaceChildren();

    if (!photos.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "No photos were saved in this round.";
      host.append(message);
    } else {
      photos.forEach(photo => host.append(photoTile(photo)));
    }
    openModal("roundModal");
  }

  async function renderRounds() {
    const group = currentGroup();
    const host = $("roundsList");
    host.replaceChildren();

    const rounds = group
      ? state.rounds
          .filter(round => round.groupId === group.id)
          .sort((a, b) => b.startedAt - a.startedAt)
      : [];

    $("emptyState").classList.toggle("hidden", rounds.length > 0);

    for (const round of rounds.slice(0, 20)) {
      const photos = await photosForRound(round.id);
      const card = document.createElement("article");
      card.className = "round-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "Open memory from " + formatDate(round.startedAt));

      const head = document.createElement("div");
      head.className = "round-head";

      const details = document.createElement("div");
      const title = document.createElement("h3");
      title.className = "round-name";
      title.textContent = round.title || "A little moment";

      const meta = document.createElement("p");
      meta.className = "round-meta";
      meta.textContent = formatDate(round.startedAt) + " · " +
        photos.length + " photo" + (photos.length === 1 ? "" : "s");

      details.append(title, meta);

      const stamp = document.createElement("span");
      stamp.className = "stamp";
      stamp.textContent = round.active && Date.now() < round.endsAt
        ? "IN PROGRESS" : "SAVED MEMORY";

      head.append(details, stamp);
      card.append(head);

      if (photos.length) {
        const grid = document.createElement("div");
        grid.className = "photo-grid";
        photos.slice(0, 3).forEach(photo => grid.append(photoTile(photo)));
        card.append(grid);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "photo-placeholder";
        placeholder.textContent = "✿";
        card.append(placeholder);
      }

      card.addEventListener("click", () => openRound(round));
      card.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openRound(round);
        }
      });

      host.append(card);
    }
  }

  async function renderCalendar() {
    const group = currentGroup();
    const host = $("calendarContent");
    host.replaceChildren();

    const rounds = group
      ? state.rounds
          .filter(round => round.groupId === group.id)
          .sort((a, b) => b.startedAt - a.startedAt)
      : [];

    if (!rounds.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "No memories yet. Your first one will show up here.";
      host.append(message);
      return;
    }

    for (const round of rounds) {
      const entry = document.createElement("div");
      entry.className = "calendar-entry";

      const title = document.createElement("strong");
      title.textContent = round.title || "Picture time!";
      const date = document.createElement("small");
      date.textContent = formatDate(round.startedAt);

      entry.append(title, date);
      entry.addEventListener("click", () => openRound(round));
      host.append(entry);
    }
  }

  async function renderAll() {
    const group = currentGroup();

    $("profileButton").textContent =
      (state.name || "?").trim().charAt(0).toUpperCase() || "?";

    renderGroups();

    $("heroHint").textContent = group
      ? "Your scrapbook: " + group.name + ". Start a round and give everyone 15 minutes."
      : "Create a group first, then start your first picture round.";

    const hasActive = group && !!activeRound(group.id);
    $("startRound").disabled = !group || !!hasActive;
    $("startRound").title = !group
      ? "Create a group first"
      : hasActive ? "A round is already active" : "Start a 15-minute round";

    await renderActiveRound();
    await renderRounds();
  }

  function showGroups() {
    renderGroups();
    openModal("groupsModal");
  }

  $("manageGroups").addEventListener("click", showGroups);
  $("groupsNav").addEventListener("click", showGroups);
  $("emptyCreate").addEventListener("click", showGroups);

  $("profileButton").addEventListener("click", () => {
    $("displayName").value = state.name || "";
    openModal("profileModal");
  });

  $("profileForm").addEventListener("submit", event => {
    event.preventDefault();
    state.name = $("displayName").value.trim().slice(0, 24);
    saveState();
    $("profileModal").close();
    renderAll();
    toast("Name saved!");
  });

  $("createGroupForm").addEventListener("submit", event => {
    event.preventDefault();
    const name = $("groupName").value.trim().slice(0, 40);
    if (!name) return;

    const group = {
      id: makeId(),
      name,
      code: makeCode(),
      createdAt: Date.now()
    };

    state.groups.push(group);
    state.currentGroupId = group.id;
    saveState();
    $("groupName").value = "";
    renderAll();
    toast("Group created! Code: " + group.code);
  });

  $("joinGroupForm").addEventListener("submit", event => {
    event.preventDefault();
    const code = $("inviteCode").value.trim().toUpperCase();
    const group = state.groups.find(item => item.code === code);

    if (!group) {
      toast("That code isn't saved in this browser. Shared invites need a database.");
      return;
    }

    state.currentGroupId = group.id;
    saveState();
    $("inviteCode").value = "";
    renderAll();
    toast("Opened " + group.name);
  });

  $("groupSelect").addEventListener("change", () => {
    state.currentGroupId = $("groupSelect").value || null;
    saveState();
    renderAll();
  });

  $("startRound").addEventListener("click", async () => {
    const group = currentGroup();
    if (!group) {
      showGroups();
      return;
    }

    if (activeRound(group.id)) {
      toast("A round is already in progress.");
      return;
    }

    const now = Date.now();
    state.rounds.push({
      id: makeId(),
      groupId: group.id,
      title: "Picture time!",
      startedAt: now,
      endsAt: now + ROUND_MS,
      active: true
    });

    saveState();
    await renderAll();
    toast("Picture time! Your 15-minute round has started.");
  });

  $("photoInput").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const group = currentGroup();
    const round = group ? activeRound(group.id) : null;

    if (!round) {
      toast("There's no active round right now.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast("Choose an image file.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast("Choose a photo under 15 MB.");
      return;
    }

    try {
      await savePhoto({
        id: makeId(),
        roundId: round.id,
        groupId: group.id,
        name: state.name || "A friend",
        createdAt: Date.now(),
        blob: file
      });
      await renderAll();
      toast("Photo added to this round!");
    } catch (error) {
      console.error(error);
      toast("Couldn't save the photo. Check your browser storage.");
    }
  });

  $("calendarButton").addEventListener("click", renderCalendarAndOpen);
  $("calendarNav").addEventListener("click", renderCalendarAndOpen);

  async function renderCalendarAndOpen() {
    await renderCalendar();
    openModal("calendarModal");
  }

  $("homeNav").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  // First-time demo group makes the home screen feel populated.
  // Remove this block if you prefer to start with an empty app.
  if (!state.groups.length) {
    const demo = {
      id: makeId(),
      name: "The Weekend Crew",
      code: makeCode(),
      createdAt: Date.now()
    };
    state.groups.push(demo);
    state.currentGroupId = demo.id;
    saveState();
  }

  renderAll();

  setInterval(() => {
    expireRounds();
    renderActiveRound();
    const group = currentGroup();
    const disabled = !group || !!activeRound(group.id);
    $("startRound").disabled = !!disabled;
  }, 1000);
})();
