const EMOTION_ORDER = ["happy", "sad", "surprised", "disgusted", "neutral", "fearful", "angry"];
const MODELS = ["model1", "model2", "model3", "model4", "model5", "model6"];
const REFERENCE_MODEL = "model0";
const STORAGE_PREFIX = "emo_eval_v2";

const views = {
  welcome: document.getElementById("welcome-view"),
  resume: document.getElementById("resume-view"),
  eval: document.getElementById("eval-view"),
  done: document.getElementById("done-view"),
};

const emailForm = document.getElementById("email-form");
const resumeSummary = document.getElementById("resume-summary");
const resumeBtn = document.getElementById("resume-btn");
const restartBtn = document.getElementById("restart-btn");
const evalTitle = document.getElementById("eval-title");
const progressPill = document.getElementById("progress-pill");
const emotionText = document.getElementById("emotion-text");
const promptText = document.getElementById("prompt-text");
const ratingsForm = document.getElementById("ratings-form");
const saveNextBtn = document.getElementById("save-next-btn");
const downloadBtn = document.getElementById("download-btn");
const submitIssueBtn = document.getElementById("submit-issue-btn");
const restartFreshBtn = document.getElementById("restart-fresh-btn");

const metricDefs = [
  { key: "intelligibility", label: "Intelligibility（可懂度）" },
  { key: "naturalness", label: "Naturalness（自然度）" },
  { key: "emotionalExpressiveness", label: "Emotional expressiveness（情感表达丰富度）" },
  { key: "overallQuality", label: "Overall quality（音频质量）" },
];

let manifest = null;
let state = null;
let evaluatorId = null;
let apiEnabled = false;
let apiBase = "/api";

function hideAllViews() {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
}

function showView(name) {
  hideAllViews();
  views[name].classList.remove("hidden");
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function makeSeededRng(seedText) {
  let seed = parseInt(hashString(seedText), 16) || 1;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 1000000) / 1000000;
  };
}

function shuffleWithSeed(arr, seedText) {
  const rng = makeSeededRng(seedText);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}


function normalizeAudioSrc(rawPath) {
  if (!rawPath) return "";
  const value = String(rawPath).trim();

  if (/^https?:\/\//i.test(value) || value.startsWith("./") || value.startsWith("../") || value.startsWith("/data/")) {
    return value;
  }

  const unixDataIdx = value.toLowerCase().lastIndexOf("/data/");
  if (unixDataIdx >= 0) {
    return `.${value.slice(unixDataIdx)}`;
  }

  const windowsNormalized = value.replace(/\\/g, "/");
  const winDataIdx = windowsNormalized.toLowerCase().lastIndexOf("/data/");
  if (winDataIdx >= 0) {
    return `.${windowsNormalized.slice(winDataIdx)}`;
  }

  const fileUrlNormalized = windowsNormalized.replace(/^file:\/\//i, "");
  const fileDataIdx = fileUrlNormalized.toLowerCase().lastIndexOf("/data/");
  if (fileDataIdx >= 0) {
    return `.${fileUrlNormalized.slice(fileDataIdx)}`;
  }

  return value;
}

function sanitizeStateAudioPaths(targetState) {
  if (!targetState?.tasks) return targetState;
  targetState.tasks.forEach((task) => {
    if (!task?.audios) return;
    Object.keys(task.audios).forEach((modelKey) => {
      task.audios[modelKey] = normalizeAudioSrc(task.audios[modelKey]);
    });
  });
  return targetState;
}

function wireAudioFallback(audioEl, rawPath) {
  audioEl.addEventListener("error", () => {
    const msg = `Audio failed to load: ${rawPath}`;
    console.warn(msg);
    audioEl.title = msg;
  });
}

function storageKey(id) {
  return `${STORAGE_PREFIX}_${id}`;
}

function saveStateToLocal() {
  localStorage.setItem(storageKey(evaluatorId), JSON.stringify(state));
}

function loadStateFromLocal(id) {
  const raw = localStorage.getItem(storageKey(id));
  return raw ? sanitizeStateAudioPaths(JSON.parse(raw)) : null;
}

async function tryLoadRemoteState(id) {
  if (!apiEnabled) return null;
  try {
    const res = await fetch(`${apiBase}/state/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evaluatorId: id }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.found ? sanitizeStateAudioPaths(data.state) : null;
  } catch {
    return null;
  }
}

async function syncState(source = "autosave") {
  saveStateToLocal();
  if (!apiEnabled) return;
  try {
    await fetch(`${apiBase}/state/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, source }),
    });
  } catch (err) {
    console.warn("Remote save failed, kept local state only", err);
  }
}

function createInitialState(email) {
  const norm = normalizeEmail(email);
  const evalId = hashString(norm);
  const tasks = [];

  for (const emotion of EMOTION_ORDER) {
    const emotionItems = manifest.emotions?.[emotion] || [];
    emotionItems.slice(0, 5).forEach((item, itemIndex) => {
      const modelOrder = shuffleWithSeed(MODELS, `${evalId}_${emotion}_${itemIndex}`);
      tasks.push({
        id: `${emotion}_${item.sampleId || itemIndex + 1}`,
        emotion,
        text: item.text,
        sampleId: item.sampleId || `sample${itemIndex + 1}`,
        modelOrder,
        audios: item.audios,
      });
    });
  }

  return sanitizeStateAudioPaths({
    version: 2,
    evaluatorEmail: norm,
    evaluatorId: evalId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentTaskIndex: 0,
    tasks,
    answers: {},
    completed: false,
  });
}

function getEmotionRange(emotion) {
  const start = state.tasks.findIndex((t) => t.emotion === emotion);
  const end = state.tasks.map((t) => t.emotion).lastIndexOf(emotion);
  return { start, end };
}

function validateEmotionLock(targetIndex) {
  const targetEmotion = state.tasks[targetIndex].emotion;
  const emoIndex = EMOTION_ORDER.indexOf(targetEmotion);
  for (let i = 0; i < emoIndex; i += 1) {
    const priorEmotion = EMOTION_ORDER[i];
    const { start, end } = getEmotionRange(priorEmotion);
    for (let j = start; j <= end; j += 1) {
      if (!state.answers[state.tasks[j].id]) return false;
    }
  }
  return true;
}

function renderTask() {
  if (state.currentTaskIndex >= state.tasks.length) {
    state.completed = true;
    syncState("completed");
    showView("done");
    return;
  }

  if (!validateEmotionLock(state.currentTaskIndex)) {
    const firstUnanswered = state.tasks.findIndex((t) => !state.answers[t.id]);
    state.currentTaskIndex = firstUnanswered >= 0 ? firstUnanswered : 0;
  }

  const task = state.tasks[state.currentTaskIndex];
  const answeredCount = Object.keys(state.answers).length;
  evalTitle.textContent = "Evaluation";
  progressPill.textContent = `${answeredCount}/${state.tasks.length}`;
  emotionText.textContent = "Listen to the reference first. Use it for Naturalness and Emotional expressiveness; compare six generated clips for Intelligibility and Overall quality. / 请先听参考语音：自然度与情感表达对照参考语音评分；可懂度与音频质量在六个模型之间比较评分。";
  promptText.textContent = `Text: "${task.text}"`;

  ratingsForm.innerHTML = "";

  const referenceSrc = task.audios?.[REFERENCE_MODEL];
  if (referenceSrc) {
    const refBlock = document.createElement("section");
    refBlock.className = "model-block";
    refBlock.innerHTML = "<h3>Reference clip</h3><p class=\"small muted\">Ground truth speech (not scored)</p>";
    const refAudio = document.createElement("audio");
    refAudio.controls = true;
    refAudio.src = normalizeAudioSrc(referenceSrc);
    wireAudioFallback(refAudio, referenceSrc);
    refBlock.appendChild(refAudio);
    ratingsForm.appendChild(refBlock);
  }

  task.modelOrder.forEach((modelId, modelIdx) => {
    const clipLabel = String.fromCharCode(65 + modelIdx);
    const modelBlock = document.createElement("section");
    modelBlock.className = "model-block";
    modelBlock.innerHTML = `<h3>Clip ${clipLabel}</h3>`;

    const audio = document.createElement("audio");
    audio.controls = true;
    const rawModelPath = task.audios?.[modelId] || "";
    audio.src = normalizeAudioSrc(rawModelPath);
    wireAudioFallback(audio, rawModelPath);
    modelBlock.appendChild(audio);

    const grid = document.createElement("div");
    grid.className = "metric-grid";

    metricDefs.forEach((metric) => {
      const metricWrap = document.createElement("div");
      metricWrap.className = "metric";
      const key = `${task.id}__${modelId}__${metric.key}`;
      const saved = state.answers[task.id]?.ratings?.[modelId]?.[metric.key];

      metricWrap.innerHTML = `
        <label for="${key}">${metric.label}</label>
        <select id="${key}" name="${key}" required>
          <option value="">Select</option>
          <option value="0" ${saved === 0 ? "selected" : ""}>0</option>
          <option value="1" ${saved === 1 ? "selected" : ""}>1</option>
          <option value="2" ${saved === 2 ? "selected" : ""}>2</option>
          <option value="3" ${saved === 3 ? "selected" : ""}>3</option>
          <option value="4" ${saved === 4 ? "selected" : ""}>4</option>
          <option value="5" ${saved === 5 ? "selected" : ""}>5</option>
        </select>`;
      grid.appendChild(metricWrap);
    });

    modelBlock.appendChild(grid);
    ratingsForm.appendChild(modelBlock);
  });

  showView("eval");
}

function collectCurrentAnswers() {
  const task = state.tasks[state.currentTaskIndex];
  const ratingByModel = {};

  for (const modelId of task.modelOrder) {
    ratingByModel[modelId] = {};
    for (const metric of metricDefs) {
      const key = `${task.id}__${modelId}__${metric.key}`;
      const val = document.getElementById(key).value;
      if (val === "") return null;
      ratingByModel[modelId][metric.key] = Number(val);
    }
  }

  return {
    taskId: task.id,
    emotion: task.emotion,
    sampleId: task.sampleId,
    text: task.text,
    modelOrderShown: task.modelOrder,
    ratings: ratingByModel,
    savedAt: new Date().toISOString(),
  };
}

function formatResumeSummary(existingState) {
  const total = existingState.tasks.length;
  const done = Object.keys(existingState.answers || {}).length;
  return `Found existing progress for ${existingState.evaluatorEmail}: ${done}/${total} completed.`;
}

emailForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = normalizeEmail(document.getElementById("email").value);
  evaluatorId = hashString(email);
  const localExisting = loadStateFromLocal(evaluatorId);
  const remoteExisting = await tryLoadRemoteState(evaluatorId);
  const existing = remoteExisting || localExisting;

  if (existing) {
    resumeSummary.textContent = formatResumeSummary(existing);
    resumeBtn.onclick = () => {
      state = existing;
      renderTask();
    };
    restartBtn.onclick = async () => {
      state = createInitialState(email);
      await syncState("restart");
      renderTask();
    };
    showView("resume");
    return;
  }

  state = createInitialState(email);
  await syncState("start");
  renderTask();
});

saveNextBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  const answer = collectCurrentAnswers();
  if (!answer) {
    alert("Please score all metrics (0-5) for all clips before continuing.");
    return;
  }
  state.answers[answer.taskId] = answer;
  state.currentTaskIndex += 1;
  state.updatedAt = new Date().toISOString();
  await syncState("next");
  renderTask();
});

downloadBtn.addEventListener("click", () => {
  const payload = {
    evaluatorEmail: state.evaluatorEmail,
    evaluatorId: state.evaluatorId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    completed: state.completed,
    answers: state.answers,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `evaluation_${state.evaluatorId}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

submitIssueBtn.addEventListener("click", () => {
  if (!manifest.repository) {
    alert("Set 'repository' in data/manifest.json as owner/repo to enable GitHub Issue submission.");
    return;
  }

  const payload = {
    evaluatorEmail: state.evaluatorEmail,
    evaluatorId: state.evaluatorId,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    completed: state.completed,
    answers: state.answers,
  };
  const title = encodeURIComponent(`Evaluation result ${state.evaluatorId}`);
  const body = encodeURIComponent("```json\n" + JSON.stringify(payload, null, 2) + "\n```");
  const url = `https://github.com/${manifest.repository}/issues/new?template=evaluation-result.yml&title=${title}&body=${body}`;
  window.open(url, "_blank");
});

restartFreshBtn.addEventListener("click", () => {
  if (state?.evaluatorId) {
    localStorage.removeItem(storageKey(state.evaluatorId));
  }
  state = null;
  evaluatorId = null;
  emailForm.reset();
  showView("welcome");
});

async function detectApi() {
  apiBase = manifest.apiBase || "/api";
  try {
    const res = await fetch(`${apiBase}/health`);
    apiEnabled = res.ok;
  } catch {
    apiEnabled = false;
  }
}

async function init() {
  try {
    const res = await fetch("./data/manifest.json");
    manifest = await res.json();
    await detectApi();
  } catch (err) {
    alert("Failed to load ./data/manifest.json. Please add the manifest file first.");
    console.error(err);
  }
  showView("welcome");
}

init();
