
import { supabase } from "./supabase.js";

(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const STORAGE_KEY = "pictureTime_profile_v1";
  const ROUND_MS = 15 * 60 * 1000;

  let user = null;
  let groups = [];
  let rounds = [];
  let photos = [];
  let currentGroupId = null;
  let toastTimer;
  let refreshInProgress = false;
  let refreshAgain = false;
  let realtimeChannel = null;

  let profile = {};
  try {
    profile = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {}

  function toast(message) {
    $("toast").textContent = message;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => $("toast").classList.remove("show"), 3000
    );
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

  function displayName() {
    return user?.user_metadata?.display_name
      || profile.name
      || user?.email?.split("@")[0]
      || "Friend";
  }

  function makeCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, b => chars[b % chars.length]).join("");
  }

  function currentGroup() {
    return groups.find(g => g.id === currentGroupId) || null;
  }

  function activeRound(groupId) {
    return rounds.find(r =>
      r.groupId === groupId && Date.now() < r.endsAt
    ) || null;
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  // Add account controls without needing to change the existing HTML.
  function createAccountBar() {
    if ($("accountBar")) return;

    const bar = document.createElement("div");
    bar.id = "accountBar";
    bar.style.cssText = [
      "position:sticky", "top:0", "z-index:100",
      "display:flex", "justify-content:flex-end",
      "align-items:center", "gap:10px",
      "padding:10px 16px", "background:#f8f5ee",
      "border-bottom:1px solid #dedbd2"
    ].join(";");

    const status = document.createElement("span");
    status.id = "accountStatus";
    status.style.cssText = "font-size:13px;overflow-wrap:anywhere";

    const button = document.createElement("button");
    button.id = "accountAction";
    button.type = "button";
    button.textContent = "Sign in";
    button.style.cssText = [
      "padding:9px 15px", "border:0", "border-radius:12px",
      "background:#4f6b58", "color:white", "font-weight:600",
      "cursor:pointer"
    ].join(";");

    button.addEventListener("click", accountAction);
    bar.append(status, button);
    document.body.prepend(bar);
  }

  async function accountAction() {
    if (user) {
      if (!confirm("Sign out of Picture Time?")) return;
      const { error } = await supabase.auth.signOut();
      if (error) toast(error.message);
      return;
    }

    const choice = prompt(
      "Enter 1 to create an account, or 2 to sign in."
    );
    if (choice !== "1" && choice !== "2") return;

    const email = prompt("Enter your email address:");
    if (!email) return;

    const password = prompt(
      choice === "1"
        ? "Create a password (at least 6 characters):"
        : "Enter your password:"
    );
    if (!password) return;

    try {
      if (choice === "1") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              display_name: profile.name || email.split("@")[0]
            }
          }
        });
        if (error) throw error;

        if (!data.session) {
          toast("Account created! Check your email to confirm, then sign in.");
          return;
        }

        toast("Account created!");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password
        });
        if (error) throw error;
        toast("Signed in!");
      }
    } catch (error) {
      console.error(error);
      toast(error.message || "Couldn't authenticate.");
    }
  }

  function renderAccount() {
    $("accountStatus").textContent = user
      ? "Signed in: " + user.email
      : "Sign in to sync your memories";
    $("accountAction").textContent = user ? "Sign out" : "Sign in";
    $("profileButton").textContent =
      displayName().trim().charAt(0).toUpperCase() || "?";
  }

  async function loadSharedData() {
    if (!user) {
      groups = [];
      rounds = [];
      photos = [];
      currentGroupId = null;
      return;
    }

    const { data: groupData, error: groupError } = await supabase
      .from("groups")
      .select("id, name, invite_code, created_at")
      .order("created_at", { ascending: true });

    if (groupError) throw groupError;

    groups = (groupData || []).map(g => ({
      id: g.id,
      name: g.name,
      code: g.invite_code,
      createdAt: new Date(g.created_at).getTime()
    }));

    if (!groups.some(g => g.id === currentGroupId)) {
      currentGroupId = groups[0]?.id || null;
    }

    if (!groups.length) {
      rounds = [];
      photos = [];
      return;
    }

    const { data: roundData, error: roundError } = await supabase
      .from("rounds")
      .select("id, group_id, created_by, created_at, ends_at")
      .in("group_id", groups.map(g => g.id))
      .order("created_at", { ascending: false });

    if (roundError) throw roundError;

    rounds = (roundData || []).map(r => ({
      id: r.id,
      groupId: r.group_id,
      createdBy: r.created_by,
      title: "Picture time!",
      startedAt: new Date(r.created_at).getTime(),
      endsAt: new Date(r.ends_at).getTime()
    }));

    if (!rounds.length) {
      photos = [];
      return;
    }

    const { data: photoData, error: photoError } = await supabase
      .from("photos")
      .select("id, round_id, user_id, storage_path, created_at")
      .in("round_id", rounds.map(r => r.id))
      .order("created_at", { ascending: true });

    if (photoError) throw photoError;

    // Create short-lived URLs from the private bucket.
    photos = await Promise.all((photoData || []).map(async p => {
      const { data, error } = await supabase.storage
        .from("picture-photos")
        .createSignedUrl(p.storage_path, 3600);

      if (error) {
        console.warn("Could not open photo", error.message);
      }

      return {
        id: p.id,
        roundId: p.round_id,
        userId: p.user_id,
        name: "A friend",
        createdAt: new Date(p.created_at).getTime(),
        url: data?.signedUrl || null
      };
    }));
  }

  function renderGroups() {
    const select = $("groupSelect");
    select.replaceChildren();

    if (!groups.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = user ? "No groups yet" : "Sign in first";
      select.append(option);
      select.disabled = true;
    } else {
      select.disabled = false;
      groups.forEach(group => {
        const option = document.createElement("option");
        option.value = group.id;
        option.textContent = group.name;
        option.selected = group.id === currentGroupId;
        select.append(option);
      });
    }

    const host = $("groupsList");
    host.replaceChildren();

    if (!user) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "Sign in to create or join a shared group.";
      host.append(message);
      return;
    }

    if (!groups.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "No groups yet. Create one to get started.";
      host.append(message);
      return;
    }

    groups.forEach(group => {
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
          prompt("Copy this invite code:", group.code);
        }
      });

      const open = document.createElement("button");
      open.className = "copy-button";
      open.textContent =
        group.id === currentGroupId ? "Selected" : "Open";
      open.addEventListener("click", async () => {
        currentGroupId = group.id;
        await renderAll();
        toast("Opened " + group.name);
      });

      actions.append(copy, open);
      row.append(info, actions);
      host.append(row);
    });
  }

  function photoTile(photo) {
    const figure = document.createElement("figure");
    figure.className = "photo-tile";

    if (photo.url) {
      const img = document.createElement("img");
      img.alt = "Shared memory";
      img.loading = "lazy";
      img.src = photo.url;
      figure.append(img);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "photo-placeholder";
      placeholder.textContent = "Photo unavailable";
      figure.append(placeholder);
    }

    const caption = document.createElement("figcaption");
    caption.textContent = photo.name || "A friend";
    figure.append(caption);
    return figure;
  }

  async function renderActiveRound() {
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

    const roundPhotos = photos.filter(p => p.roundId === round.id);

    if (!roundPhotos.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "No photos yet. Be the first to add one!";
      host.append(message);
    } else {
      roundPhotos.forEach(photo => host.append(photoTile(photo)));
    }
  }

  async function openRound(round) {
    const roundPhotos = photos.filter(p => p.roundId === round.id);
    $("roundDate").textContent = formatDate(round.startedAt).toUpperCase();
    $("roundTitle").textContent = round.title || "Picture time!";

    const host = $("roundPhotos");
    host.replaceChildren();

    if (!roundPhotos.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "No photos were saved in this round.";
      host.append(message);
    } else {
      roundPhotos.forEach(photo => host.append(photoTile(photo)));
    }

    openModal("roundModal");
  }

  async function renderRounds() {
    const group = currentGroup();
    const host = $("roundsList");
    host.replaceChildren();

    const groupRounds = group
      ? rounds.filter(r => r.groupId === group.id)
          .sort((a, b) => b.startedAt - a.startedAt)
      : [];

    $("emptyState").classList.toggle("hidden", groupRounds.length > 0);

    for (const round of groupRounds.slice(0, 20)) {
      const roundPhotos = photos.filter(p => p.roundId === round.id);
      const card = document.createElement("article");
      card.className = "round-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label",
        "Open memory from " + formatDate(round.startedAt));

      const head = document.createElement("div");
      head.className = "round-head";

      const details = document.createElement("div");
      const title = document.createElement("h3");
      title.className = "round-name";
      title.textContent = round.title || "A little moment";

      const meta = document.createElement("p");
      meta.className = "round-meta";
      meta.textContent = formatDate(round.startedAt) + " · " +
        roundPhotos.length + " photo" +
        (roundPhotos.length === 1 ? "" : "s");

      details.append(title, meta);

      const stamp = document.createElement("span");
      stamp.className = "stamp";
      stamp.textContent = Date.now() < round.endsAt
        ? "IN PROGRESS" : "SAVED MEMORY";

      head.append(details, stamp);
      card.append(head);

      if (roundPhotos.length) {
        const grid = document.createElement("div");
        grid.className = "photo-grid";
        roundPhotos.slice(0, 3)
          .forEach(photo => grid.append(photoTile(photo)));
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

    const groupRounds = group
      ? rounds.filter(r => r.groupId === group.id)
          .sort((a, b) => b.startedAt - a.startedAt)
      : [];

    if (!groupRounds.length) {
      const message = document.createElement("p");
      message.className = "muted";
      message.textContent = "No memories yet. Your first one will show up here.";
      host.append(message);
      return;
    }

    groupRounds.forEach(round => {
      const entry = document.createElement("div");
      entry.className = "calendar-entry";

      const title = document.createElement("strong");
      title.textContent = round.title || "Picture time!";
      const date = document.createElement("small");
      date.textContent = formatDate(round.startedAt);

      entry.append(title, date);
      entry.addEventListener("click", () => openRound(round));
      host.append(entry);
    });
  }

  async function renderAll() {
    renderAccount();
    renderGroups();

    const group = currentGroup();

    $("heroHint").textContent = !user
      ? "Sign in to start sharing memories with your friends."
      : group
        ? "Your scrapbook: " + group.name +
          ". Start a round and give everyone 15 minutes."
        : "Create a group first, then start your first picture round.";

    const hasActive = group && !!activeRound(group.id);
    $("startRound").disabled = !user || !group || !!hasActive;
    $("startRound").title = !user
      ? "Sign in first"
      : !group ? "Create a group first"
      : hasActive ? "A round is already active"
      : "Start a 15-minute round";

    await renderActiveRound();
    await renderRounds();
  }

  async function refreshSharedData() {
    if (refreshInProgress) {
      refreshAgain = true;
      return;
    }

    refreshInProgress = true;
    try {
      do {
        refreshAgain = false;
        await loadSharedData();
        await renderAll();
      } while (refreshAgain);
    } catch (error) {
      console.error("Picture Time refresh failed:", error);
      toast("Couldn't sync: " + error.message);
    } finally {
      refreshInProgress = false;
    }
  }

  function subscribeToChanges() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    if (!user) return;

    realtimeChannel = supabase
      .channel("picture-time-live-" + user.id)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "groups"
      }, refreshSharedData)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "group_members"
      }, refreshSharedData)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "rounds"
      }, refreshSharedData)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "photos"
      }, refreshSharedData)
      .subscribe();
  }

  function showGroups() {
    renderGroups();
    openModal("groupsModal");
  }

  $("manageGroups").addEventListener("click", showGroups);
  $("groupsNav").addEventListener("click", showGroups);
  $("emptyCreate").addEventListener("click", showGroups);

  $("profileButton").addEventListener("click", () => {
    $("displayName").value = profile.name || displayName();
    openModal("profileModal");
  });

  $("profileForm").addEventListener("submit", async event => {
    event.preventDefault();
    const name = $("displayName").value.trim().slice(0, 24);
    if (!name) return;

    profile.name = name;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));

    if (user) {
      const { error } = await supabase.auth.updateUser({
        data: { display_name: name }
      });
      if (error) {
        toast("Name saved on this device, but cloud update failed.");
        console.error(error);
      }
    }

    $("profileModal").close();
    await renderAll();
    toast("Name saved!");
  });

  $("createGroupForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!user) {
      toast("Sign in first.");
      return;
    }

    const name = $("groupName").value.trim().slice(0, 60);
    if (!name) return;

    try {
      let result;
      for (let attempt = 0; attempt < 4; attempt++) {
        result = await supabase.rpc("create_group", {
          p_name: name,
          p_invite_code: makeCode()
        });

        if (!result.error) break;
        if (!/duplicate|unique/i.test(result.error.message)) {
          throw result.error;
        }
      }

      if (result.error) throw result.error;

      currentGroupId = result.data;
      $("groupName").value = "";
      await refreshSharedData();
      toast("Group created! Share its invite code with friends.");
    } catch (error) {
      console.error(error);
      toast("Couldn't create group: " + error.message);
    }
  });

  $("joinGroupForm").addEventListener("submit", async event => {
    event.preventDefault();
    if (!user) {
      toast("Sign in first.");
      return;
    }

    const code = $("inviteCode").value.trim().toUpperCase();
    if (!code) return;

    try {
      const { data, error } = await supabase.rpc("join_group", {
        p_invite_code: code
      });
      if (error) throw error;

      currentGroupId = data;
      $("inviteCode").value = "";
      await refreshSharedData();
      toast("Joined group successfully!");
    } catch (error) {
      console.error(error);
      toast("Couldn't join group: " + error.message);
    }
  });

  $("groupSelect").addEventListener("change", async () => {
    currentGroupId = $("groupSelect").value || null;
    await renderAll();
  });

  $("startRound").addEventListener("click", async () => {
    const group = currentGroup();
    if (!user) {
      toast("Sign in first.");
      return;
    }
    if (!group) {
      showGroups();
      return;
    }
    if (activeRound(group.id)) {
      toast("A round is already in progress.");
      return;
    }

    try {
      const { error } = await supabase.rpc("start_round", {
        p_group_id: group.id
      });
      if (error) throw error;

      await refreshSharedData();
      toast("Picture time! Your 15-minute round has started.");
    } catch (error) {
      console.error(error);
      toast("Couldn't start round: " + error.message);
      await refreshSharedData();
    }
  });

  $("photoInput").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!user) {
      toast("Sign in first.");
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

    const group = currentGroup();
    const round = group ? activeRound(group.id) : null;
    if (!round) {
      toast("There's no active round right now.");
      return;
    }

    try {
      const extension = ({
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/heic": "heic",
        "image/heif": "heif"
      })[file.type] || "img";

      const path = [
        group.id,
        round.id,
        user.id,
        crypto.randomUUID() + "." + extension
      ].join("/");

      const { error: uploadError } = await supabase.storage
        .from("picture-photos")
        .upload(path, file, {
          contentType: file.type,
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { error: metadataError } = await supabase
        .from("photos")
        .insert({
          round_id: round.id,
          user_id: user.id,
          storage_path: path
        });

      if (metadataError) {
        await supabase.storage.from("picture-photos").remove([path]);
        throw metadataError;
      }

      await refreshSharedData();
      toast("Photo shared with your group!");
    } catch (error) {
      console.error(error);
      toast("Couldn't upload photo: " + error.message);
    }
  });

  $("calendarButton").addEventListener("click", renderCalendarAndOpen);
  $("calendarNav").addEventListener("click", renderCalendarAndOpen);

  async function renderCalendarAndOpen() {
    await renderCalendar();
    openModal("calendarModal");
  }

  $("homeNav").addEventListener("click", () =>
    window.scrollTo({ top: 0, behavior: "smooth" })
  );

  async function init() {
    createAccountBar();

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error(error);
      toast("Couldn't check sign-in: " + error.message);
    }

    user = data?.session?.user || null;
    await refreshSharedData();
    subscribeToChanges();

    supabase.auth.onAuthStateChange((_event, session) => {
      user = session?.user || null;
      currentGroupId = null;
      subscribeToChanges();
      // Avoid doing Supabase requests inside the auth callback itself.
      setTimeout(refreshSharedData, 0);
    });

    // Refresh the countdown display once a second.
    setInterval(() => {
      renderActiveRound();
      const group = currentGroup();
      $("startRound").disabled =
        !user || !group || !!activeRound(group.id);
    }, 1000);
  }

  init();
})();
