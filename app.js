
import { supabase } from "./supabase.js";

/* Picture Time — app controller */

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  groups: [],
  rounds: [],
  photos: [],
  selectedGroupId: "",
  calendarDate: new Date(),
  selectedCalendarDay: dateKey(new Date()),
  loading: false,
  channel: null,
  timerInterval: null,
};

const BUCKET = "picture-photos";
const ROUND_LENGTH_MINUTES = 15;
const SIGNED_URL_SECONDS = 3600;

function dateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function initials(value = "") {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1
    ? words[0][0] + words[1][0]
    : (words[0] || "?").slice(0, 2)
  ).toUpperCase();
}

function formatDate(value, options = {}) {
  if (!value) return "";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  });
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function toast(message) {
  const el = $("toast");
  if (!el) {
    console.log(message);
    return;
  }

  el.textContent = message;
  el.hidden = false;

  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

function setButtonBusy(button, busy, busyText = "Please wait…") {
  if (!button) return;

  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
    delete button.dataset.originalText;
  }
}

function activeRoundFor(groupId = state.selectedGroupId) {
  const now = Date.now();

  return state.rounds
    .filter((round) =>
      round.groupId === groupId &&
      new Date(round.endsAt).getTime() > now
    )
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null;
}

function photosForRound(roundId) {
  return state.photos
    .filter((photo) => photo.roundId === roundId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function selectedGroup() {
  return state.groups.find((group) => group.id === state.selectedGroupId) || null;
}

/* Navigation */

function switchView(viewName) {
  const validViews = ["home", "calendar", "groups", "profile"];
  if (!validViews.includes(viewName)) viewName = "home";

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `${viewName}View`);
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === viewName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });

  if (viewName === "calendar") renderCalendar();
  if (viewName === "profile") renderProfile();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setupNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  $("brandHome")?.addEventListener("click", (event) => {
    event.preventDefault();
    switchView("home");
  });

  $("profileButton")?.addEventListener("click", () => switchView("profile"));
  $("calendarButton")?.addEventListener("click", () => switchView("calendar"));
  $("calendarNav")?.addEventListener("click", () => switchView("calendar"));
  $("manageGroups")?.addEventListener("click", () => switchView("groups"));
  $("emptyCreate")?.addEventListener("click", () => switchView("groups"));
}

/* Account and authentication */

async function accountAction() {
  if (state.user) {
    const confirmed = window.confirm("Sign out of Picture Time?");
    if (!confirmed) return;

    const { error } = await supabase.auth.signOut();

    if (error) {
      toast(error.message);
      return;
    }

    toast("You've signed out.");
    return;
  }

  const choice = window.prompt(
    "Enter 1 to sign in, or 2 to create an account."
  );

  if (choice !== "1" && choice !== "2") return;

  const email = window.prompt("Enter your email address:");
  if (!email) return;

  const password = window.prompt(
    choice === "2"
      ? "Create a password (at least 6 characters):"
      : "Enter your password:"
  );

  if (!password) return;

  if (choice === "2") {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) {
      toast(error.message);
      return;
    }

    if (data.session) {
      toast("Account created! Welcome to Picture Time.");
    } else {
      toast("Check your email to confirm your account, then sign in.");
    }
  } else {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      toast(error.message);
      return;
    }

    toast("Welcome back!");
  }
}

function renderProfile() {
  const user = state.user;
  const displayName =
    user?.user_metadata?.display_name ||
    user?.user_metadata?.full_name ||
    user?.email?.split("@")[0] ||
    "Picture taker";

  if ($("profileAvatarLarge")) {
    $("profileAvatarLarge").textContent = initials(displayName);
  }

  if ($("profileDisplayName")) {
    $("profileDisplayName").textContent = displayName;
  }

  if ($("profileEmail")) {
    $("profileEmail").textContent = user?.email || "Not signed in";
  }

  if ($("displayName")) {
    $("displayName").value = user?.user_metadata?.display_name || "";
  }

  if ($("profileAccountAction")) {
    $("profileAccountAction").textContent = user ? "Sign out" : "Sign in";
    $("profileAccountAction").onclick = accountAction;
  }
}

function setupProfile() {
  $("profileForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.user) {
      toast("Sign in first to save your profile.");
      await accountAction();
      return;
    }

    const name = $("displayName")?.value.trim();

    if (!name) {
      toast("Please enter a display name.");
      return;
    }

    const { error } = await supabase.auth.updateUser({
      data: { display_name: name },
    });

    if (error) {
      toast(error.message);
      return;
    }

    const { data } = await supabase.auth.getUser();
    state.user = data.user;
    renderProfile();
    toast("Profile updated!");
  });

  renderProfile();
}

/* Load groups, rounds, and photos */

async function loadData() {
  if (!state.user) {
    state.groups = [];
    state.rounds = [];
    state.photos = [];
    state.selectedGroupId = "";
    renderAll();
    return;
  }

  try {
    const { data: memberships, error: membershipError } = await supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", state.user.id);

    if (membershipError) throw membershipError;

    const groupIds = [...new Set((memberships || []).map((item) => item.group_id))];

    if (!groupIds.length) {
      state.groups = [];
      state.rounds = [];
      state.photos = [];
      state.selectedGroupId = "";
      renderAll();
      return;
    }

    const { data: groups, error: groupsError } = await supabase
      .from("groups")
      .select("id, name, invite_code, created_by, created_at")
      .in("id", groupIds)
      .order("created_at", { ascending: false });

    if (groupsError) throw groupsError;

    state.groups = (groups || []).map((group) => ({
      id: group.id,
      name: group.name,
      code: group.invite_code,
      createdBy: group.created_by,
      createdAt: group.created_at,
    }));

    if (!state.groups.some((group) => group.id === state.selectedGroupId)) {
      state.selectedGroupId = state.groups[0]?.id || "";
    }

    const { data: rounds, error: roundsError } = await supabase
      .from("rounds")
      .select("id, group_id, created_by, created_at, ends_at")
      .in("group_id", groupIds)
      .order("created_at", { ascending: false });

    if (roundsError) throw roundsError;

    state.rounds = (rounds || []).map((round) => ({
      id: round.id,
      groupId: round.group_id,
      createdBy: round.created_by,
      startedAt: round.created_at,
      endsAt: round.ends_at,
      title: "Picture Time",
    }));

    const roundIds = state.rounds.map((round) => round.id);

    if (!roundIds.length) {
      state.photos = [];
    } else {
      const { data: photos, error: photosError } = await supabase
        .from("photos")
        .select("id, round_id, user_id, storage_path, created_at")
        .in("round_id", roundIds)
        .order("created_at", { ascending: true });

      if (photosError) throw photosError;

      state.photos = await Promise.all((photos || []).map(async (photo) => {
        let url = "";

        const { data: signed, error: signedError } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(photo.storage_path, SIGNED_URL_SECONDS);

        if (!signedError) url = signed?.signedUrl || "";

        return {
          id: photo.id,
          roundId: photo.round_id,
          userId: photo.user_id,
          storagePath: photo.storage_path,
          createdAt: photo.created_at,
          name: `Photo ${formatTime(photo.created_at)}`,
          url,
        };
      }));
    }

    renderAll();
  } catch (error) {
    console.error("Could not load Picture Time data:", error);
    toast(`Couldn't load your groups: ${error.message}`);
  }
}

/* Home screen */

function renderGroupSelect() {
  const select = $("groupSelect");
  if (!select) return;

  const previous = state.selectedGroupId;

  select.replaceChildren();

  if (!state.groups.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = state.user ? "Create or join a group first" : "Sign in to get started";
    select.append(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;

  state.groups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.name;
    select.append(option);
  });

  select.value = state.groups.some((group) => group.id === previous)
    ? previous
    : state.groups[0].id;

  state.selectedGroupId = select.value;
}

function renderHome() {
  renderGroupSelect();

  const group = selectedGroup();
  const round = activeRoundFor();
  const signedIn = Boolean(state.user);

  if ($("heroHint")) {
    $("heroHint").textContent = !signedIn
      ? "Sign in to create a group, share an invite code, and capture moments together."
      : !group
        ? "Create a group or join friends with an invite code to start taking pictures together."
        : `You're sharing moments with ${group.name}. Ready for a new round?`;
  }

  if ($("roundStatus")) {
    $("roundStatus").textContent = round
      ? "Round in progress"
      : group
        ? "Ready when you are"
        : "No group selected";
  }

  if ($("startCardTitle")) {
    $("startCardTitle").textContent = round
      ? "Picture time is happening!"
      : "Start a picture round";
  }

  if ($("startCardText")) {
    $("startCardText").textContent = round
      ? "Add your photos before the timer runs out."
      : "Everyone in your group has 15 minutes to share their moment.";
  }

  if ($("startRound")) {
    $("startRound").disabled = !signedIn || !group || Boolean(round);
    $("startRound").textContent = round ? "Round in progress" : "Start picture time";
  }

  if ($("activeRound")) {
    $("activeRound").hidden = !round;
  }

  if ($("timer")) {
    $("timer").textContent = round ? remainingTime(round.endsAt) : "15:00";
  }

  if ($("photoInput")) {
    $("photoInput").disabled = !round || !signedIn;
  }

  if ($("calendarButton")) {
    $("calendarButton").disabled = !signedIn;
  }

  const activePhotos = $("activePhotos");
  if (activePhotos) {
    activePhotos.replaceChildren();

    if (round) {
      const photos = photosForRound(round.id);

      photos.forEach((photo) => {
        if (!photo.url) return;

        const wrapper = document.createElement("div");
        wrapper.className = "photo-item";

        const img = document.createElement("img");
        img.src = photo.url;
        img.alt = "Photo from this Picture Time round";
        img.loading = "lazy";

        wrapper.append(img);
        activePhotos.append(wrapper);
      });
    }
  }

  const emptyState = $("emptyState");
  if (emptyState) {
    emptyState.hidden = Boolean(round);
  }

  renderRecentRounds();
}

function remainingTime(endsAt) {
  const remaining = Math.max(0, new Date(endsAt).getTime() - Date.now());
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderRecentRounds() {
  const list = $("roundsList");
  if (!list) return;

  list.replaceChildren();

  const groupId = state.selectedGroupId;
  const rounds = state.rounds
    .filter((round) => round.groupId === groupId)
    .slice(0, 8);

  if (!rounds.length) {
    const message = document.createElement("p");
    message.className = "subtle";
    message.textContent = state.user
      ? "Your past picture rounds will show up here."
      : "Sign in to see your picture rounds.";
    list.append(message);
    return;
  }

  rounds.forEach((round) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "round-item";
    item.style.width = "100%";
    item.style.textAlign = "left";

    const avatar = document.createElement("span");
    avatar.className = "round-avatar";
    avatar.textContent = "✦";

    const content = document.createElement("span");
    content.className = "round-item-content";

    const title = document.createElement("h3");
    title.textContent = formatDate(round.startedAt, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    const detail = document.createElement("p");
    detail.textContent = `${photosForRound(round.id).length} photos · ${formatTime(round.startedAt)}`;

    content.append(title, detail);
    item.append(avatar, content);

    item.addEventListener("click", () => openRound(round.id));
    list.append(item);
  });
}

/* Groups screen */

function renderGroups() {
  const list = $("groupsList");
  if (!list) return;

  list.replaceChildren();

  if (!state.user) {
    const message = document.createElement("p");
    message.className = "subtle";
    message.textContent = "Sign in to create or join a group.";
    list.append(message);
    return;
  }

  if (!state.groups.length) {
    const message = document.createElement("p");
    message.className = "subtle";
    message.textContent = "No groups yet. Create one or enter a friend's invite code.";
    list.append(message);
    return;
  }

  state.groups.forEach((group) => {
    const item = document.createElement("div");
    item.className = "group-item";

    const avatar = document.createElement("span");
    avatar.className = "group-avatar";
    avatar.textContent = initials(group.name);

    const content = document.createElement("div");
    content.className = "group-item-content";

    const title = document.createElement("h3");
    title.textContent = group.name;

    const subtitle = document.createElement("p");
    subtitle.textContent = `Invite code: ${group.code}`;

    content.append(title, subtitle);

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "secondary";
    selectButton.textContent = group.id === state.selectedGroupId ? "Selected" : "Open";
    selectButton.addEventListener("click", () => {
      state.selectedGroupId = group.id;
      renderAll();
      switchView("home");
    });

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "icon-button";
    copyButton.title = "Copy invite code";
    copyButton.setAttribute("aria-label", "Copy invite code");
    copyButton.textContent = "↗";
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(group.code);
        toast("Invite code copied!");
      } catch {
        window.prompt("Copy this invite code:", group.code);
      }
    });

    item.append(avatar, content, selectButton, copyButton);
    list.append(item);
  });
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function setupGroups() {
  $("createGroupForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.user) {
      toast("Sign in before creating a group.");
      await accountAction();
      return;
    }

    const name = $("groupName")?.value.trim();
    if (!name) {
      toast("Enter a name for your group.");
      return;
    }

    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    setButtonBusy(button, true, "Creating…");

    try {
      const { error } = await supabase.rpc("create_group", {
        p_name: name,
        p_invite_code: makeCode(),
      });

      if (error) throw error;

      $("groupName").value = "";
      await loadData();
      toast("Your group is ready!");
    } catch (error) {
      toast(`Couldn't create the group: ${error.message}`);
    } finally {
      setButtonBusy(button, false);
    }
  });

  $("joinGroupForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.user) {
      toast("Sign in before joining a group.");
      await accountAction();
      return;
    }

    const code = $("inviteCode")?.value.trim().toUpperCase();
    if (!code) {
      toast("Enter an invite code.");
      return;
    }

    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    setButtonBusy(button, true, "Joining…");

    try {
      const { error } = await supabase.rpc("join_group", {
        p_invite_code: code,
      });

      if (error) throw error;

      $("inviteCode").value = "";
      await loadData();
      toast("You've joined the group!");
    } catch (error) {
      toast(`Couldn't join the group: ${error.message}`);
    } finally {
      setButtonBusy(button, false);
    }
  });

  $("groupSelect")?.addEventListener("change", (event) => {
    state.selectedGroupId = event.target.value;
    renderHome();
  });
}

/* Start a round and upload photos */

function setupRounds() {
  $("startRound")?.addEventListener("click", async () => {
    if (!state.user) {
      toast("Sign in to start a round.");
      await accountAction();
      return;
    }

    const group = selectedGroup();
    if (!group) {
      toast("Create or join a group first.");
      switchView("groups");
      return;
    }

    if (activeRoundFor(group.id)) {
      toast("There's already a round in progress for this group.");
      return;
    }

    const button = $("startRound");
    setButtonBusy(button, true, "Starting…");

    try {
      const { error } = await supabase.rpc("start_round", {
        p_group_id: group.id,
      });

      if (error) throw error;

      await loadData();
      toast("Picture time has started!");
    } catch (error) {
      toast(`Couldn't start a round: ${error.message}`);
    } finally {
      setButtonBusy(button, false);
      renderHome();
    }
  });

  $("photoInput")?.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const round = activeRoundFor();
    if (!state.user || !round) {
      toast("There's no active round to upload to.");
      event.target.value = "";
      return;
    }

    if (Date.now() >= new Date(round.endsAt).getTime()) {
      toast("This round has ended.");
      event.target.value = "";
      await loadData();
      return;
    }

    const input = event.target;
    input.disabled = true;

    let uploadedCount = 0;

    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          toast("Please choose image files.");
          continue;
        }

        const extension = file.name.includes(".")
          ? file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "")
          : "jpg";

        const path = `${round.groupId}/${round.id}/${state.user.id}/${crypto.randomUUID()}.${extension || "jpg"}`;

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, {
            contentType: file.type,
            upsert: false,
          });

        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase
          .from("photos")
          .insert({
            round_id: round.id,
            user_id: state.user.id,
            storage_path: path,
          });

        if (insertError) {
          await supabase.storage.from(BUCKET).remove([path]);
          throw insertError;
        }

        uploadedCount++;
      }

      await loadData();

      if (uploadedCount) {
        toast(uploadedCount === 1 ? "Photo added!" : `${uploadedCount} photos added!`);
      }
    } catch (error) {
      console.error("Photo upload failed:", error);
      toast(`Couldn't upload photos: ${error.message}`);
    } finally {
      input.value = "";
      input.disabled = false;
      renderHome();
    }
  });
}

/* Calendar */

function renderCalendar() {
  const container = $("calendarContent");
  if (!container) return;

  container.replaceChildren();

  if (!state.user) {
    const message = document.createElement("p");
    message.className = "subtle";
    message.textContent = "Sign in to see your picture-time calendar.";
    container.append(message);
    return;
  }

  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dateKey(new Date());

  const header = document.createElement("div");
  header.className = "calendar-header";

  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "icon-button";
  previous.textContent = "‹";
  previous.setAttribute("aria-label", "Previous month");
  previous.addEventListener("click", () => {
    state.calendarDate = new Date(year, month - 1, 1);
    renderCalendar();
  });

  const title = document.createElement("h2");
  title.textContent = state.calendarDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  title.style.margin = "0";
  title.style.fontSize = "19px";

  const next = document.createElement("button");
  next.type = "button";
  next.className = "icon-button";
  next.textContent = "›";
  next.setAttribute("aria-label", "Next month");
  next.addEventListener("click", () => {
    state.calendarDate = new Date(year, month + 1, 1);
    renderCalendar();
  });

  header.append(previous, title, next);
  container.append(header);

  const card = document.createElement("div");
  card.className = "card";

  const grid = document.createElement("div");
  grid.className = "calendar-grid";

  ["S", "M", "T", "W", "T", "F", "S"].forEach((day) => {
    const label = document.createElement("div");
    label.className = "calendar-weekday";
    label.textContent = day;
    grid.append(label);
  });

  for (let i = 0; i < startOffset; i++) {
    const blank = document.createElement("div");
    grid.append(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const key = dateKey(date);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.textContent = String(day);

    if (key === todayKey) button.classList.add("today");
    if (key === state.selectedCalendarDay) button.classList.add("selected");

    const dayRounds = state.rounds.filter((round) =>
      dateKey(round.startedAt) === key &&
      state.groups.some((group) => group.id === round.groupId)
    );

    if (dayRounds.length) {
      button.classList.add("has-event");
      button.title = `${dayRounds.length} picture round${dayRounds.length === 1 ? "" : "s"}`;
    }

    button.addEventListener("click", () => {
      state.selectedCalendarDay = key;
      renderCalendar();
    });

    grid.append(button);
  }

  card.append(grid);
  container.append(card);

  const eventsHeading = document.createElement("div");
  eventsHeading.className = "section-heading";

  const eventsTitle = document.createElement("h3");
  eventsTitle.textContent = new Date(`${state.selectedCalendarDay}T12:00:00`)
    .toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

  eventsHeading.append(eventsTitle);
  container.append(eventsHeading);

  const events = document.createElement("div");
  events.className = "calendar-events";

  const dayRounds = state.rounds.filter((round) =>
    dateKey(round.startedAt) === state.selectedCalendarDay &&
    state.groups.some((group) => group.id === round.groupId)
  );

  if (!dayRounds.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.textContent = "☼";

    const text = document.createElement("p");
    text.textContent = "No picture rounds on this day. A fresh day for new memories!";

    empty.append(icon, text);
    events.append(empty);
  } else {
    dayRounds.forEach((round) => {
      const group = state.groups.find((item) => item.id === round.groupId);

      const item = document.createElement("button");
      item.type = "button";
      item.className = "round-item";
      item.style.width = "100%";
      item.style.textAlign = "left";

      const avatar = document.createElement("span");
      avatar.className = "round-avatar";
      avatar.textContent = "✦";

      const content = document.createElement("span");
      content.className = "round-item-content";

      const heading = document.createElement("h3");
      heading.textContent = group?.name || "Picture Time";

      const details = document.createElement("p");
      details.textContent = `${formatTime(round.startedAt)} · ${photosForRound(round.id).length} photos`;

      content.append(heading, details);
      item.append(avatar, content);
      item.addEventListener("click", () => openRound(round.id));
      events.append(item);
    });
  }

  container.append(events);
}

/* Round details */

function openRound(roundId) {
  const round = state.rounds.find((item) => item.id === roundId);
  if (!round) return;

  const modal = $("roundModal");
  if (!modal) return;

  if ($("roundDate")) {
    $("roundDate").textContent = formatDate(round.startedAt, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  if ($("roundTitle")) {
    const group = state.groups.find((item) => item.id === round.groupId);
    $("roundTitle").textContent = group?.name || "Picture Time";
  }

  const gallery = $("roundPhotos");

  if (gallery) {
    gallery.replaceChildren();

    const photos = photosForRound(round.id);

    if (!photos.length) {
      const message = document.createElement("p");
      message.className = "subtle";
      message.textContent = "No photos were added to this round.";
      gallery.append(message);
    }

    photos.forEach((photo) => {
      if (!photo.url) return;

      const wrapper = document.createElement("div");
      wrapper.className = "photo-item";

      const img = document.createElement("img");
      img.src = photo.url;
      img.alt = "Photo from Picture Time";
      img.loading = "lazy";

      wrapper.append(img);
      gallery.append(wrapper);
    });
  }

  if (typeof modal.showModal === "function") {
    if (!modal.open) modal.showModal();
  } else {
    modal.setAttribute("open", "");
  }
}

/* Keep active-round countdown fresh */

function updateTimer() {
  const round = activeRoundFor();

  if ($("timer") && round) {
    $("timer").textContent = remainingTime(round.endsAt);
  }

  if (state.user && state.rounds.some((item) =>
    new Date(item.endsAt).getTime() <= Date.now()
  )) {
    renderHome();
  }
}

/* Realtime updates */

function setupRealtime() {
  if (state.channel) {
    supabase.removeChannel(state.channel);
    state.channel = null;
  }

  if (!state.user) return;

  state.channel = supabase
    .channel(`picture-time-${state.user.id}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "group_members",
    }, () => loadData())
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "groups",
    }, () => loadData())
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "rounds",
    }, () => loadData())
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "photos",
    }, () => loadData())
    .subscribe();
}

/* Render everything */

function renderAll() {
  renderHome();
  renderGroups();
  renderProfile();

  if ($("calendarView")?.classList.contains("active")) {
    renderCalendar();
  }
}

/* Start the app */

async function init() {
  setupNavigation();
  setupProfile();
  setupGroups();
  setupRounds();

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error("Couldn't check session:", error);
    toast("Couldn't check your login status.");
  }

  state.user = data?.session?.user || null;

  await loadData();
  setupRealtime();

  supabase.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user || null;

    // Let Supabase finish processing the auth event before fetching protected data.
    setTimeout(async () => {
      await loadData();
      setupRealtime();
    }, 0);
  });

  if (state.timerInterval) clearInterval(state.timerInterval);
  state.timerInterval = setInterval(updateTimer, 1000);

  renderAll();
}

init();
