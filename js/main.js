import { initializeApp } from "https://www.gstatic.com/firebasejs/9.20.0/firebase-app.js";
import { getDatabase, ref, set } from "https://www.gstatic.com/firebasejs/9.20.0/firebase-database.js";

// Lambdaの関数URL
const LAMBDA_URL = 'Lambda関数URL';

// Firebase設定
const firebaseConfig = {
  apiKey: "xxx",
  authDomain: "xxx",
  databaseURL: "xxx",
  projectId: "xxx",
  storageBucket: "xxx",
  messagingSenderId: "xxx",
  appId: "xxx"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// DOM取得
const chatBox = document.getElementById('chat');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const hintBtn = document.getElementById('hintBtn');

// グローバル変数
let displayName = "あなた"; // 表示名
let roomId = null;
let messages = [];
let questionCount = 0;
let score = 0;
const MAX_QUESTIONS = 3;
let quizEnded = false;

// ルームIDを生成（ランダム6桁英数字＋_YYYYMMDDhhmmss）
function generateRoomId() {
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  const now = new Date();
  const pad = n => n.toString().padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const min = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  const timeStr = `${y}_${m}${d}_${h}${min}${s}`;
  return `${timeStr}_${rand}`;
}

// ランダムなユーザー名生成
function generateRandomUserName() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 4; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return 'ユーザー' + rand;
}

// 名前入力ダイアログ
function showNameDialog(onDecide) {
  const dialog = document.createElement('div');
  dialog.style.position = 'fixed';
  dialog.style.top = '0';
  dialog.style.left = '0';
  dialog.style.width = '100vw';
  dialog.style.height = '100vh';
  dialog.style.background = 'rgba(0,0,0,0.7)';
  dialog.style.display = 'flex';
  dialog.style.justifyContent = 'center';
  dialog.style.alignItems = 'center';
  dialog.style.zIndex = '9999';

  const inner = document.createElement('div');
  inner.style.background = '#fff';
  inner.style.padding = '28px 22px';
  inner.style.borderRadius = '12px';
  inner.style.textAlign = 'center';
  inner.innerHTML = `
    <h2>名前を入力してください</h2>
    <input id="nameInput" type="text" maxlength="12" placeholder="例：さとう" style="font-size:1.1em;padding:6px 10px;border-radius:6px;border:1px solid #ccc;width:70%"><br>
    <button id="decideNameBtn" style="font-size:1.1em;padding:8px 20px;margin-top:16px;">決定</button>
  `;
  dialog.appendChild(inner);
  document.body.appendChild(dialog);

  document.getElementById('decideNameBtn').onclick = () => {
    let name = document.getElementById('nameInput').value.trim();
    if (!name) name = generateRandomUserName();
    document.body.removeChild(dialog);
    onDecide(name);
  };
}

// スタートダイアログ
function showStartDialog() {
  // 入力欄・ボタンを有効化
  userInput.disabled = false;
  sendBtn.disabled = false;
  hintBtn.disabled = false;

  const dialog = document.createElement('div');
  dialog.style.position = 'fixed';
  dialog.style.top = '0';
  dialog.style.left = '0';
  dialog.style.width = '100vw';
  dialog.style.height = '100vh';
  dialog.style.background = 'rgba(0,0,0,0.7)';
  dialog.style.display = 'flex';
  dialog.style.justifyContent = 'center';
  dialog.style.alignItems = 'center';
  dialog.style.zIndex = '9999';

  const inner = document.createElement('div');
  inner.style.background = '#fff';
  inner.style.padding = '32px 24px';
  inner.style.borderRadius = '14px';
  inner.style.textAlign = 'center';
  inner.innerHTML = `
    <h2>チャット風ワード当てクイズ</h2>
    <button id="startQuizBtn" style="font-size:1.2em;padding:10px 30px;margin-top:16px;">クイズをはじめる</button>
  `;
  dialog.appendChild(inner);
  document.body.appendChild(dialog);

  document.getElementById('startQuizBtn').onclick = () => {
    document.body.removeChild(dialog);
    showNameDialog(function(name) {
      displayName = name;
      roomId = generateRoomId();
      messages = [
        { role: "system", content: "あなたはLINE風チャットクイズの出題AIです。出題は必ず記述式（ワード当て）で行い、選択肢は絶対に出さないでください。最初から合計3問だけを連続で出題し、各問題のタイトルは必ず「【第1問】」「【第2問】」「【第3問】」のように何問目かを明記してください。1問ごとにユーザーの回答を受けて正誤判定とヒントを出し、3問終了後は自動的に「あなたのスコアは○点です」などの結果発表を行ってください。各問題の出題形式は「〇〇をカタカナで答えなさい」「〇〇を漢字で答えなさい」「〇〇の名前を答えなさい」などとし、ジャンルは果物、人物、地名、動物、歴史上の出来事など何でも構いません。最初のヒントはとても難しく、正解を出すのはほぼ不可能なレベルにしてください（例：その果物の100gあたりの主な栄養素、ある人物の出身地や生没年だけ、地名の標高や人口だけ、など）。出題内容やヒントからすぐに答えがわからないようにし、答えを推測する楽しさを重視してください。3問が終わったら「クイズ終了！あなたのスコアは○点です」と必ず表示し、追加の問題は出題しないでください。" }
      ];
      questionCount = 0;
      score = 0;
      quizEnded = false;
      clearChat();
      startQuiz();
    });
  };
}

// クイズ開始
function startQuiz() {
  addMessage("クイズを始めます。最初の問題を出しますね！", 'ai');
  addUserMessage("最初の問題");
  sendToLambda();
}

// チャット欄にメッセージ追加
function addMessage(text, sender = 'ai') {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = sender === 'user' ? displayName : 'クイズAI';
  messageDiv.appendChild(label);
  const bubble = document.createElement('div');
  bubble.className = `bubble ${sender}`;
  bubble.textContent = text;
  messageDiv.appendChild(bubble);
  chatBox.appendChild(messageDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// Firebaseにmessages配列を保存
function saveMessagesToFirebase() {
  set(ref(db, `chatlogs/${roomId}`), messages);
}

// Firebaseにスコアを保存
function saveScoreToFirebase() {
  const scoreRef = ref(db, `scores/${roomId}`);
  set(scoreRef, {
    name: displayName,
    score: score,
    date: new Date().toISOString()
  }).catch((error) => {
    console.error("スコア保存エラー:", error);
    addMessage("スコア保存に失敗しました", 'ai');
  });
}

// クイズ履歴をクリア
function clearChat() {
  chatBox.innerHTML = '';
}

// ユーザー発言をmessages配列に追加
function addUserMessage(text) {
  messages.push({ role: "user", content: text });
  saveMessagesToFirebase();
}

// AI応答をmessages配列に追加
function addAssistantMessage(text) {
  messages.push({ role: "assistant", content: text });
  saveMessagesToFirebase();
}

// 送信ボタン
sendBtn.onclick = () => {
  if (quizEnded) return;
  const text = userInput.value.trim();
  if (!text) return;
  addMessage(text, 'user');
  addUserMessage(text);
  userInput.value = '';
  sendToLambda();
};

// ヒントボタン
hintBtn.onclick = () => {
  if (quizEnded) return;
  addMessage("ヒント", 'user');
  addUserMessage("ヒント");
  sendToLambda();
};

// Enterキーでも送信
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendBtn.onclick();
});

// Lambdaにmessages配列ごとPOSTし、送信データ・レスポンスをconsole.log
async function sendToLambda() {
  if (quizEnded) return; // 終了後は何もしない

  const postData = { messages };
  try {
    const res = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postData)
    });
    const data = await res.json();
    addMessage(data.reply, 'ai');
    addAssistantMessage(data.reply);

    // 新しい問題が出た場合のみカウント
    if (data.isQuestion) {
      questionCount++;
      if (questionCount >= MAX_QUESTIONS) {
        quizEnded = true;
        setTimeout(showResult, 1000); // 1秒後にスコア表示
      }
    }
    // 正解時のスコア加算
    if (data.isCorrect) score++;
    if (data.reply.includes("クイズ終了") || data.reply.includes("あなたのスコアは")) {
      quizEnded = true;
      // 入力欄やボタンを無効化
      userInput.disabled = true;
      sendBtn.disabled = true;
      hintBtn.disabled = true;
      saveScoreToFirebase(); // ←ここを追加
    }
  } catch (err) {
    addMessage("サーバーとの通信に失敗しました。", 'ai');
    addAssistantMessage("サーバーとの通信に失敗しました。");
  }
}

// 結果発表画面
function showResult() {
  clearChat();
  addMessage(`クイズ終了！あなたのスコアは${score}点です`, 'ai');
  saveScoreToFirebase();
  setTimeout(showStartDialog, 5000); // 5秒後に再スタート
}

// ページ読み込み時にスタートダイアログ表示
window.onload = () => {
  showStartDialog();
};
