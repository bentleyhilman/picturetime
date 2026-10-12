
import { supabase } from "./supabase.js";

const $ = (id) => document.getElementById(id);
const PHOTO_BUCKET = "picture-photos";
const AVATAR_BUCKET = "profile-photos";
const ROUND_MINUTES = 15;
const SHARED_GROUP_ID = "00000000-0000-4000-8000-000000000001";
const SIGNED_URL_SECONDS = 3600;

const state = {
  user: null,
  groups: [],
  rounds: [],
  photos: [],
  circle: null,
  selectedDay: dateKey(new Date()),
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  channel: null,
  signupMode: false,
  timer: null,
  loading: false,
};

const greetings = [
  ["Hey there.", "Ready to make a memory?"],
  ["Good to see you.", "Let's save a little moment."],
  ["What's the moment?", "Your next memory starts here."],
  ["Hi, you.", "Got anything worth remembering today?"],
  ["A little hello.", "Let's make today count."],
];

function dateKey(value) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || "?").slice(0, 2)).toUpperCase();
}

function displayName() {
  return state.user?.user_metadata?.display_name ||
    state.user?.user_metadata?.full_name ||
    state.user?.email?.split("@")[0] ||
    "";
}

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timeout);
  toast.timeout = setTimeout(() => { el.hidden = true; }, 3200);
}

function friendlyError(error) {
  const message = error?.message || "Something went wrong. Please try again.";
  console.error(error);
  return message;
}

function formatDate(value, options = {}) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric", ...options,
  });
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Internally, every account uses the same shared group.
function circle() {
  return state.circle;
}

function activeRound() {
  const group = circle();
  if (!group) return null;
  const now = Date.now();

  return state.rounds
    .filter((r) => r.groupId === group.id && new Date(r.endsAt).getTime() > now)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null;
}

function photosInRound(roundId) {
  return state.photos
    .filter((p) => p.roundId === roundId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function switchView(name) {
  ["home", "calendar", "profile"].forEach((view) => {
    $(`${view}View`)?.classList.toggle("active", view === name);
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (name === "calendar") renderCalendar();
  if (name === "profile") renderProfile();

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

  $("headerAvatar")?.addEventListener("click", () => switchView("profile"));
  $("allPicturesButton")?.addEventListener("click", () => switchView("calendar"));
  $("closeRoundDialog")?.addEventListener("click", () => $("roundDialog")?.close());

  $("roundDialog")?.addEventListener("click", (event) => {
    if (event.target === $("roundDialog")) $("roundDialog").close();
  });
}

/* Authentication */

function setAuthMode(signup) {
  state.signupMode = signup;
  $("authHeading").textContent = signup ? "Create your account" : "Welcome back";
  $("authDescription").textContent = signup
    ? "Create an account to keep your memories in sync."
    : "Sign in to see your pictures on your devices.";
  $("authSubmit").textContent = signup ? "Create account" : "Sign in";
  $("authPassword").autocomplete = signup ? "new-password" : "current-password";
  $("authModeButton").textContent = signup
    ? "Already have an account? Sign in"
    : "Create an account instead";
}

function setupAuth() {
  $("authModeButton")?.addEventListener("click", () => setAuthMode(!state.signupMode));

  $("authForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const button = $("authSubmit");

    button.disabled = true;
    button.textContent = state.signupMode ? "Creating account…" : "Signing in…";

    try {
      if (state.signupMode) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        if (data.session) {
          toast("Account created. Welcome!");
        } else {
          toast("Check your email to confirm your account, then sign in.");
          setAuthMode(false);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast("You're signed in.");
      }
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      button.disabled = false;
      button.textContent = state.signupMode ? "Create account" : "Sign in";
    }
  });

  $("signOutButton")?.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) toast(friendlyError(error));
    else toast("Signed out.");
  });

  $("profileForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.user) return;

    const name = $("displayName").value.trim();
    if (!name) {
      toast("Enter a display name first.");
      return;
    }

    const button = event.submitter;
    if (button) button.disabled = true;

    try {
      const { data, error } = await supabase.auth.updateUser({
        data: { display_name: name },
      });
      if (error) throw error;

      state.user = data.user;
      renderProfile();
      renderGreeting();
      toast("Profile saved.");
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      if (button) button.disabled = false;
    }
  });

  $("changeAvatarButton")?.addEventListener("click", () => {
    if (!state.user) {
      toast("Sign in before adding a profile picture.");
      return;
    }
    $("avatarInput").click();
  });

  $("avatarInput")?.addEventListener("change", uploadAvatar);
}

function renderProfile() {
  const signedIn = Boolean(state.user);
  const name = displayName();

  $("authPanel").hidden = signedIn;
  $("accountPanel").hidden = !signedIn;

  $("profileName").textContent = signedIn ? (name || "Your profile") : "Your profile";
  $("profileEmail").textContent = signedIn
    ? (state.user.email || "Signed in")
    : "Sign in to sync your memories.";

  $("profileInitials").textContent = initials(name || state.user?.email || "?");
  $("headerAvatar").textContent = initials(name || state.user?.email || "?");

  const avatarUrl = state.user?.user_metadata?.avatar_url || "";
  const avatar = $("profileAvatar");

  if (avatarUrl) {
    avatar.src = avatarUrl;
    avatar.hidden = false;
    $("profileInitials").hidden = true;
    $("headerAvatar").innerHTML = "";

    const headerImage = document.createElement("img");
    headerImage.src = avatarUrl;
    headerImage.alt = "";
    $("headerAvatar").append(headerImage);
  } else {
    avatar.removeAttribute("src");
    avatar.hidden = true;
    $("profileInitials").hidden = false;
    $("headerAvatar").textContent = initials(name || state.user?.email || "?");
  }

  if (signedIn) {
    $("displayName").value = state.user.user_metadata?.display_name || "";
  }
}

async function uploadAvatar(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || !state.user) return;

  if (!file.type.startsWith("image/")) {
    toast("Choose an image file.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    toast("Choose an image smaller than 5 MB.");
    return;
  }

  const extension = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "jpg";

  const path = `${state.user.id}/${crypto.randomUUID()}.${extension}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    const avatarUrl = `${publicData.publicUrl}?v=${Date.now()}`;

    const { data, error } = await supabase.auth.updateUser({
      data: { avatar_url: avatarUrl },
    });

    if (error) throw error;

    state.user = data.user;
    renderProfile();
    toast("Profile picture updated.");
  } catch (error) {
    toast(`Couldn't update your picture: ${friendlyError(error)}`);
  }
}

/* Shared data */

async function loadData() {
  if (!state.user) {
    state.groups = [];
    state.rounds = [];
    state.photos = [];
    state.circle = null;
    renderAll();
    return;
  }

  try {
    // One shared group is used internally; users no longer create or join circles.
    state.groups = [{
      id: SHARED_GROUP_ID,
      name: "Everyone",
      code: null,
      createdAt: null,
    }];
    state.circle = state.groups[0];

    // Load rounds from the shared feed and preserve access to older round history.
    const { data: rounds, error: roundsError } = await supabase
      .from("rounds")
      .select("id,group_id,created_by,created_at,ends_at")
      .order("created_at", { ascending: false });

    if (roundsError) throw roundsError;

    state.rounds = (rounds || []).map((r) => ({
      id: r.id,
      groupId: r.group_id,
      createdBy: r.created_by,
      startedAt: r.created_at,
      endsAt: r.ends_at,
    }));

    const roundIds = state.rounds.map((r) => r.id);

    if (!roundIds.length) {
      state.photos = [];
    } else {
      const { data: photos, error: photosError } = await supabase
        .from("photos")
        .select("id,round_id,user_id,storage_path,created_at")
        .in("round_id", roundIds)
        .order("created_at", { ascending: true });

      if (photosError) throw photosError;

      state.photos = await Promise.all((photos || []).map(async (p) => {
        const { data: signed, error: signedError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .createSignedUrl(p.storage_path, SIGNED_URL_SECONDS);

        return {
          id: p.id,
          roundId: p.round_id,
          userId: p.user_id,
          path: p.storage_path,
          createdAt: p.created_at,
          url: signedError ? "" : (signed?.signedUrl || ""),
        };
      }));
    }

    renderAll();
  } catch (error) {
    toast(`Couldn't load your memories: ${friendlyError(error)}`);
  }
}

/* Home */

function renderGreeting() {
  const name = displayName();
  const [base, subtitle] = greetings[Math.floor(Math.random() * greetings.length)];

  $("greeting").textContent = name ? `${base.replace(/\.$/, "")}, ${name}.` : base;
  $("greetingSubtitle").textContent = state.user
    ? subtitle
    : "Sign in from Profile to save and share your memories.";

  $("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  }).toUpperCase();
}

function renderHome() {
  const round = activeRound();
  const signedIn = Boolean(state.user);

  $("roundStatus").textContent = round ? "ROUND IN PROGRESS" : "READY WHEN YOU ARE";
  $("roundDot").classList.toggle("is-live", Boolean(round));
  $("roundHeading").textContent = round ? "Make the most of it." : "It's picture time.";

  $("roundDescription").textContent = round
    ? "Your round is live. Add photos before time runs out."
    : !signedIn
      ? "Sign in to start a round with everyone."
      : "Start a round and share a little piece of your day.";

  $("timer").hidden = !round;
  $("timer").textContent = round ? remainingTime(round.endsAt) : "";
  $("startRound").textContent = round ? "Round in progress" : "Start picture time";
  $("startRound").disabled = !signedIn || Boolean(round);
  $("uploadLabel").hidden = !round;
  $("photoInput").disabled = !round;

  $("roundNote").textContent = round
    ? `${photosInRound(round.id).length} photos added · ends ${formatTime(round.endsAt)}`
    : "A round lasts 15 minutes.";

  const recent = state.photos
    .filter((p) => p.url)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6);

  const grid = $("recentPhotos");
  grid.replaceChildren();

  recent.forEach((photo) => {
    const tile = document.createElement("div");
    tile.className = "photo-tile";

    const img = document.createElement("img");
    img.src = photo.url;
    img.alt = "A shared Picture Time photo";
    img.loading = "lazy";

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Open photo round");
    button.addEventListener("click", () => openRound(photo.roundId));

    tile.append(img, button);
    grid.append(tile);
  });

  $("recentEmpty").hidden = recent.length > 0;

  const rounds = state.rounds
    .slice()
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, 4);

  renderRoundList($("recentRounds"), rounds);
  $("roundsEmpty").hidden = rounds.length > 0;
}

function remainingTime(endsAt) {
  const seconds = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function setupRoundActions() {
  $("startRound")?.addEventListener("click", async () => {
    if (!state.user) {
      toast("Sign in from Profile to start picture time.");
      switchView("profile");
      return;
    }

    if (activeRound()) {
      toast("A round is already in progress.");
      return;
    }

    const button = $("startRound");
    button.disabled = true;
    button.textContent = "Starting…";

    try {
      const { error } = await supabase.rpc("start_round", {
        p_group_id: SHARED_GROUP_ID,
      });

      if (error) throw error;

      await loadData();
      toast("Picture time started!");
    } catch (error) {
      toast(`Couldn't start the round: ${friendlyError(error)}`);
    } finally {
      renderHome();
    }
  });

  $("photoInput")?.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    const round = activeRound();

    if (!round || !state.user) {
      toast("There isn't an active round.");
      return;
    }

    if (files.some((file) => !file.type.startsWith("image/"))) {
      toast("Please choose image files.");
      return;
    }

    if (files.some((file) => file.size > 12 * 1024 * 1024)) {
      toast("Each photo must be smaller than 12 MB.");
      return;
    }

    const input = $("photoInput");
    input.disabled = true;
    $("uploadLabel").textContent = "Uploading…";

    let uploaded = 0;

    try {
      for (const file of files) {
        const extension = (file.name.split(".").pop() || "jpg")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "") || "jpg";

        const path = `${round.groupId}/${round.id}/${state.user.id}/${crypto.randomUUID()}.${extension}`;

        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });

        if (uploadError) throw uploadError;

        const { error: rowError } = await supabase.from("photos").insert({
          round_id: round.id,
          user_id: state.user.id,
          storage_path: path,
        });

        if (rowError) {
          await supabase.storage.from(PHOTO_BUCKET).remove([path]);
          throw rowError;
        }

        uploaded++;
      }

      await loadData();

      if (uploaded) {
        toast(uploaded === 1 ? "Photo added." : `${uploaded} photos added.`);
      }
    } catch (error) {
      toast(`Upload failed: ${friendlyError(error)}`);
    } finally {
      input.disabled = false;
      $("uploadLabel").textContent = "Add photos";
      renderHome();
    }
  });
}

/* Calendar and round history */

function renderRoundList(container, rounds) {
  container.replaceChildren();

  rounds.forEach((round) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "round-row";

    const dateIcon = document.createElement("span");
    dateIcon.className = "round-date-icon";
    dateIcon.textContent = new Date(round.startedAt).toLocaleDateString(undefined, {
      month: "short", day: "numeric",
    });

    const copy = document.createElement("span");
    copy.className = "round-row-copy";

    const title = document.createElement("strong");
    title.textContent = state.groups.find((g) => g.id === round.groupId)?.name || "Picture Time";

    const details = document.createElement("small");
    details.textContent = `${formatTime(round.startedAt)} · ${photosInRound(round.id).length} photos`;

    copy.append(title, details);

    const count = document.createElement("span");
    count.className = "round-row-count";
    count.textContent = "View →";

    button.append(dateIcon, copy, count);
    button.addEventListener("click", () => openRound(round.id));
    container.append(button);
  });
}

function renderCalendar() {
  const grid = $("calendarGrid");
  if (!grid) return;

  grid.replaceChildren();

  const year = state.calendarMonth.getFullYear();
  const month = state.calendarMonth.getMonth();

  $("calendarMonth").textContent = state.calendarMonth.toLocaleDateString(undefined, {
    month: "long", year: "numeric",
  });

  ["S", "M", "T", "W", "T", "F", "S"].forEach((day) => {
    const el = document.createElement("span");
    el.className = "weekday";
    el.textContent = day;
    grid.append(el);
  });

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = dateKey(new Date());

  for (let i = 0; i < firstWeekday; i++) {
    const blank = document.createElement("span");
    grid.append(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(new Date(year, month, day));
    const hasRound = state.rounds.some((r) => dateKey(r.startedAt) === key);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.textContent = String(day);

    if (key === today) button.classList.add("today");
    if (key === state.selectedDay) button.classList.add("selected");
    if (hasRound) button.classList.add("has-round");

    button.addEventListener("click", () => {
      state.selectedDay = key;
      renderCalendar();
    });

    grid.append(button);
  }

  $("selectedDateHeading").textContent = new Date(`${state.selectedDay}T12:00:00`)
    .toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric",
    });

  const rounds = state.rounds
    .filter((r) => dateKey(r.startedAt) === state.selectedDay)
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

  renderRoundList($("dayRounds"), rounds);
  $("dayEmpty").hidden = rounds.length > 0;
}

function setupCalendar() {
  $("previousMonth")?.addEventListener("click", () => {
    state.calendarMonth = new Date(
      state.calendarMonth.getFullYear(),
      state.calendarMonth.getMonth() - 1,
      1
    );
    renderCalendar();
  });

  $("nextMonth")?.addEventListener("click", () => {
    state.calendarMonth = new Date(
      state.calendarMonth.getFullYear(),
      state.calendarMonth.getMonth() + 1,
      1
    );
    renderCalendar();
  });
}

/* Photo history dialog */

function openRound(roundId) {
  const round = state.rounds.find((r) => r.id === roundId);
  if (!round) return;

  $("dialogRoundTitle").textContent =
    state.groups.find((g) => g.id === round.groupId)?.name || "Picture Time";

  $("dialogRoundDate").textContent = formatDate(round.startedAt, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  const grid = $("dialogPhotos");
  grid.replaceChildren();

  const photos = photosInRound(roundId).filter((p) => p.url);

  photos.forEach((photo) => {
    const tile = document.createElement("div");
    tile.className = "photo-tile";

    const img = document.createElement("img");
    img.src = photo.url;
    img.alt = "Shared memory";
    img.loading = "lazy";

    tile.append(img);
    grid.append(tile);
  });

  $("dialogPhotosEmpty").hidden = photos.length > 0;

  if (!$("roundDialog").open) $("roundDialog").showModal();
}

/* Realtime and startup */

function renderAll() {
  renderGreeting();
  renderHome();
  renderProfile();

  if ($("calendarView").classList.contains("active")) {
    renderCalendar();
  }
}

function setupRealtime() {
  if (state.channel) supabase.removeChannel(state.channel);
  state.channel = null;

  if (!state.user) return;

  state.channel = supabase
    .channel(`picture-time-${state.user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, () => loadData())
    .on("postgres_changes", { event: "*", schema: "public", table: "groups" }, () => loadData())
    .on("postgres_changes", { event: "*", schema: "public", table: "rounds" }, () => loadData())
    .on("postgres_changes", { event: "*", schema: "public", table: "photos" }, () => loadData())
    .subscribe();
}

async function init() {
  setupNavigation();
  setupAuth();
  setupRoundActions();
  setupCalendar();
  setAuthMode(false);

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    toast(`Couldn't check sign-in status: ${friendlyError(error)}`);
  }

  state.user = data?.session?.user || null;
  await loadData();
  setupRealtime();

  supabase.auth.onAuthStateChange((_event, session) => {
    state.user = session?.user || null;

    setTimeout(async () => {
      await loadData();
      setupRealtime();
    }, 0);
  });

  state.timer = setInterval(() => {
    const round = activeRound();

    if (round) {
      $("timer").textContent = remainingTime(round.endsAt);

      if (new Date(round.endsAt).getTime() <= Date.now()) {
        loadData();
      }
    }
  }, 1000);

  renderAll();
}

init();
