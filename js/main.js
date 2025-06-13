// main.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.20.0/firebase-app.js";
import { getDatabase, ref, set, query, orderByChild, equalTo, get, update, onValue } from "https://www.gstatic.com/firebasejs/9.20.0/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.20.0/firebase-auth.js";

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

// Firebase初期化
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth();

// DOM取得
const chatBox = document.getElementById('chat');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const hintBtn = document.getElementById('hintBtn');
const roomStatus = document.getElementById('roomStatus');
const partBoard = document.getElementById('participantsBoard');

// グローバル変数
let displayName = "あなた";
let userId = null;
let roomId = null;
let messages = [];
let score = 0;
let quizEnded = false;
let myUid = null;
let isOwner = false;
let chatUnsubscribe = null;
let partUnsubscribe = null;
let scoresUnsubscribe = null;
let quizEndUnsubscribe = null;
let participants = {};
let scores = {};
let currentQuestion = 1; // 現在の問題番号を追跡
let processedAnswers = new Set(); // 処理済み回答を追跡

// ルームID生成
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
  const timeStr = `${y}${m}${d}${h}${min}${s}`;
  return `${timeStr}_${rand}`;
}

// ランダムなユーザーID生成
function generateUserId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 8; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return rand;
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

// 進行中ルームを取得
async function getActiveRoom() {
  const roomsRef = ref(db, "rooms");
  const snapshot = await get(roomsRef);
  if (!snapshot.exists()) return null;
  const rooms = snapshot.val();
  let latestRoom = null;
  let latestTime = 0;
  for (let id in rooms) {
    if (rooms[id].isActive && new Date(rooms[id].createdAt).getTime() > latestTime) {
      latestRoom = { id, ...rooms[id] };
      latestTime = new Date(rooms[id].createdAt).getTime();
    }
  }
  return latestRoom;
}

// 自分が参加中のルームがあるかチェック
async function findMyParticipatingRoom() {
  const roomsRef = ref(db, "rooms");
  const snapshot = await get(roomsRef);
  if (!snapshot.exists()) return null;
  
  const rooms = snapshot.val();
  for (let roomId in rooms) {
    const room = rooms[roomId];
    if (room.isActive && room.participants) {
      // participantsの中に自分のUIDがあるかチェック
      for (let participantId in room.participants) {
        // participantDataにuidが保存されているかチェック
        const participantRef = ref(db, `rooms/${roomId}/participantData/${participantId}`);
        const participantSnapshot = await get(participantRef);
        if (participantSnapshot.exists()) {
          const participantData = participantSnapshot.val();
          if (participantData.uid === myUid) {
            return {
              roomId: roomId,
              userId: participantId,
              userName: room.participants[participantId],
              isOwner: room.ownerUid === myUid
            };
          }
        }
      }
    }
  }
  return null;
}

// ルーム作成
async function createRoom(ownerName) {
  const newRoomId = generateRoomId();
  const roomData = {
    ownerName: ownerName,
    ownerUid: myUid,
    createdAt: new Date().toISOString(),
    isActive: true,
    participants: {},
    participantData: {},
    currentQuestion: 1
  };
  await set(ref(db, `rooms/${newRoomId}`), roomData);
  return newRoomId;
}

// ルーム参加
async function joinRoom(roomId, userName) {
  // const newUserId = generateUserId(); // ← これを削除
  const newUserId = myUid; // Firebase認証のUIDを使う

  // participantsテーブルに名前を登録
  await update(ref(db, `rooms/${roomId}/participants`), { [newUserId]: userName });

  // participantDataテーブルにUID情報を登録
  await set(ref(db, `rooms/${roomId}/participantData/${newUserId}`), {
    uid: newUserId,
    name: userName,
    joinedAt: new Date().toISOString()
  });

  // スコアテーブルにも初期値0で登録
  await set(ref(db, `scores/${roomId}/${newUserId}`), {
    name: userName,
    score: 0,
    date: new Date().toISOString()
  });
  return newUserId;
}

// チャット欄にメッセージ追加
function addMessage(text, sender = 'ai', user = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = sender === 'user' ? (user || 'ユーザー') : 'クイズAI';
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
  const scoreRef = ref(db, `scores/${roomId}/${userId}`);
  set(scoreRef, {
    name: displayName,
    score: score,
    date: new Date().toISOString()
  }).catch((error) => {
    console.error("スコア保存エラー:", error);
    addMessage("スコア保存に失敗しました", 'ai');
  });
}

// ルームを閉じる
function closeRoom() {
  if (roomId) {
    update(ref(db, `rooms/${roomId}`), { isActive: false });
  }
}

// クイズ履歴をクリア
function clearChat() {
  chatBox.innerHTML = '';
}

// ユーザー発言をmessages配列に追加
function addUserMessage(text) {
  const messageId = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`; // ユニークID生成
  messages.push({ 
    role: "user", 
    content: text, 
    user: displayName, 
    userId: userId, 
    timestamp: new Date().toISOString(),
    messageId: messageId // メッセージにユニークIDを追加
  });
  saveMessagesToFirebase();
}

// AI応答をmessages配列に追加
function addAssistantMessage(text) {
  messages.push({ 
    role: "assistant", 
    content: text, 
    timestamp: new Date().toISOString() 
  });
  saveMessagesToFirebase();
  checkAndRecordCorrectAnswer(text);
}

// 正解判定＆集計（修正版）
function checkAndRecordCorrectAnswer(assistantText) {
  if (!/正解です！/.test(assistantText)) return;
  // 否定語が含まれていたらreturn
  if (/(不正解|残念|間違い)/.test(assistantText)) return;
  
  // 現在の問題番号を特定
  let qNum = currentQuestion;
  if (/第1問/.test(assistantText) || /第一問/.test(assistantText)) {
    qNum = 1;
  } else if (/第2問/.test(assistantText) || /第二問/.test(assistantText)) {
    qNum = 2;
  } else if (/第3問/.test(assistantText) || /第三問/.test(assistantText)) {
    qNum = 3;
  }

  // 直前のユーザーメッセージを取得（最新のユーザーメッセージ）
  const lastUserMessage = [...messages].reverse().find(msg => msg.role === "user");

  if (lastUserMessage && lastUserMessage.userId && lastUserMessage.messageId) {
    // ここで userId を myUid に置き換える
    const answerKey = `${lastUserMessage.messageId}_q${qNum}`;

    if (processedAnswers.has(answerKey)) return;
    processedAnswers.add(answerKey);

    // Firebaseに正解記録
    const resultRef = ref(db, `quiz_results/${roomId}/q${qNum}/${myUid}`);
    get(resultRef).then(snapshot => {
      if (!snapshot.exists()) {
        set(resultRef, {
          userId: myUid,
          userName: lastUserMessage.user,
          timestamp: lastUserMessage.timestamp,
          questionNumber: qNum,
          messageId: lastUserMessage.messageId
        }).then(() => {
          console.log("正解記録完了:", lastUserMessage.user, "問題", qNum);
          updateScore(myUid, lastUserMessage.user);
        });
      } else {
        console.log("Already recorded:", lastUserMessage.user, "問題", qNum);
      }
    });
  }
}

// スコア加点（修正版）
function updateScore(targetUserId, targetUserName) {
  console.log("スコア更新前 targetUserId:", targetUserId);
  const scoreRef = ref(db, `scores/${roomId}/${targetUserId}`);
  
  // トランザクション的な更新を行う
  get(scoreRef).then(snapshot => {
    let currentScore = 0;
    if (snapshot.exists() && snapshot.val().score) {
      currentScore = snapshot.val().score;
    }
    
    const newScore = currentScore + 1;
    console.log(`スコア更新: ${targetUserName} ${currentScore} → ${newScore}`);
    
    return set(scoreRef, {
      name: targetUserName,
      score: newScore,
      date: new Date().toISOString()
    });
  }).then(() => {
    console.log("スコア更新完了:", targetUserName);
  }).catch(error => {
    console.error("スコア更新エラー:", error);
  });
}

// チャットのリアルタイム購読
function subscribeChat() {
  if (chatUnsubscribe) chatUnsubscribe();
  const chatRef = ref(db, `chatlogs/${roomId}`);
  chatUnsubscribe = onValue(chatRef, (snapshot) => {
    const logs = snapshot.val() || [];
    chatBox.innerHTML = '';
    logs.forEach(msg => {
      if (msg.role === "system") return; // AIの最初のクイズ出題メッセージは表示させない
      addMessage(msg.content, msg.role === "user" ? "user" : "ai", msg.user);
    });
    messages = logs;
  });
}

// 参加者+スコア一覧のリアルタイム購読
function subscribeParticipantsAndScores() {
  if (partUnsubscribe) partUnsubscribe();
  if (scoresUnsubscribe) scoresUnsubscribe();

  const partRef = ref(db, `rooms/${roomId}/participants`);
  const scoresRef = ref(db, `scores/${roomId}`);

  participants = {};
  scores = {};

  function renderParticipantsBoard() {
    let html = '<b>参加者一覧</b>';
    const entries = Object.entries(participants).map(([uid, name]) => {
      const scoreObj = scores[uid];
      return { name, score: scoreObj ? scoreObj.score : 0 };
    });
    entries.sort((a, b) => b.score - a.score);
    html += '<div style="margin-top:8px;">';
    entries.forEach(({ name, score }) => {
      html += `
        <div class="participant-row">
          <span class="participant-name">${name}</span>
          <span class="participant-score">${score} 点</span>
        </div>
      `;
    });
    html += '</div>';
    partBoard.innerHTML = html;
  }

  partUnsubscribe = onValue(partRef, (snapshot) => {
    participants = snapshot.val() || {};
    renderParticipantsBoard();
  });

  scoresUnsubscribe = onValue(scoresRef, (snapshot) => {
    scores = snapshot.val() || {};
    renderParticipantsBoard();
  });
}

// クイズ終了通知のリアルタイム購読（修正版）
function subscribeQuizEnd() {
  if (quizEndUnsubscribe) quizEndUnsubscribe();
  const endRef = ref(db, `quizEnd/${roomId}`);
  quizEndUnsubscribe = onValue(endRef, (snapshot) => {
    const val = snapshot.val();
    if (val && val.ended && !quizEnded) {
      console.log("クイズ終了通知を受信:", val);
      quizEnded = true;
      userInput.disabled = true;
      sendBtn.disabled = true;
      hintBtn.disabled = true;
      
      // 全参加者に対して結果画面を表示
      // showResult();
      
      // 5秒後にルーム選択画面に戻る
      /*setTimeout(() => {
        console.log("ルーム選択画面に戻る");
        showRoomEntry();
      }, 5000); */
    }
  });
}

// 送信ボタン
sendBtn.onclick = async () => {
  if (quizEnded) return;
  // ルームのisActiveをチェック
  const roomRef = ref(db, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists() || snapshot.val().isActive === false) {
    alert("クイズが終了されました。リロードします。");
    location.reload();
    return;
  }
  const text = userInput.value.trim();
  if (!text) return;
  addUserMessage(text);
  userInput.value = '';
  sendToLambda();
};

// ヒントボタン
hintBtn.onclick = async () => {
  if (quizEnded) return;
  // ルームのisActiveをチェック
  const roomRef = ref(db, `rooms/${roomId}`);
  const snapshot = await get(roomRef);
  if (!snapshot.exists() || snapshot.val().isActive === false) {
    alert("クイズが終了されました。リロードします。");
    location.reload();
    return;
  }
  addUserMessage("ヒント");
  sendToLambda();
};

// Enterキーでも送信
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendBtn.onclick();
});

// Lambdaにmessages配列ごとPOST（修正版）
async function sendToLambda() {
  if (quizEnded) return;
  const postData = {
    messages,
    participants: Object.entries(participants).map(([uid, name]) => ({ userId: uid, userName: name })),
    scores: Object.entries(scores).map(([uid, s]) => ({ userId: uid, name: s.name, score: s.score }))
  };
  try {
    const res = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postData)
    });
    const data = await res.json();
    addAssistantMessage(data.reply);

    // クイズ終了判定
    if (data.isQuizEnd || /クイズ終了/.test(data.reply)) {
      console.log("クイズ終了を検出");
      quizEnded = true;
      userInput.disabled = true;
      sendBtn.disabled = true;
      hintBtn.disabled = true;
      
      // オーナーのみがルームを閉じる
      if (isOwner) {
        closeRoom();
        // 全参加者に終了通知を送信
        await set(ref(db, `quizEnd/${roomId}`), { 
          ended: true, 
          timestamp: new Date().toISOString(),
          triggeredBy: userId
        });
        console.log("クイズ終了通知を送信");
      }
    }
  } catch (err) {
    console.error("Lambda通信エラー:", err);
    addMessage("サーバーとの通信に失敗しました。", 'ai');
  }
}

// 結果発表画面（修正版）
function showResult() {
  console.log("結果画面を表示");
  // 結果は既にチャットに表示されているので、特別な処理は不要
  // UIの無効化のみ行う
  userInput.disabled = true;
  sendBtn.disabled = true;
  hintBtn.disabled = true;
  
  // ルームステータスを更新
  roomStatus.innerHTML = `
    <div class="quiz-end-status">
      <span style="color: #ff6b6b; font-weight: bold;">クイズ終了！</span>
      <span style="font-size: 0.9em; color: #666;">5秒後にルーム選択画面に戻ります</span>
    </div>
  `;
}

// クイズ開始
function startQuiz() {
  const statusText = isOwner ? "あなたはルームオーナー" : "ルームに復帰しました";
  roomStatus.innerHTML = `
    <div class="active-room-card">
      <div class="active-room-info">
        <span class="room-status">${statusText}</span>
      </div>
      <button id="resetRoomBtn" class="reset-room-btn">リセット</button>
    </div>
  `;
  // リセットボタンのイベントリスナー
  document.getElementById('resetRoomBtn').onclick = async () => {
    if (confirm("本当にリセットしますか？")) {
      // rooms/${roomId}/isActive を false に更新
      await update(ref(db, `rooms/${roomId}`), { isActive: false });
      document.getElementById('resetRoomBtn').style.display = 'none';
      location.reload();
    }
  };

  // 2. systemロールの指示文はmessages配列にだけ入れる（表示しない）
  if (!messages.length) {
    messages = [
      { role: "system", content: `
あなたはLINE風チャットクイズの出題AIです。出題は必ず記述式（ワード当て）で行い、選択肢は絶対に出さないでください。最初から合計3問だけを連続で出題し、各問題のタイトルは必ず「【第1問】」「【第2問】」「【第3問】」のように何問目かを明記してください。

【出題形式ルール】
- 出題は「〇〇をカタカナで答えなさい」「〇〇を漢字で答えなさい」「〇〇の名前を答えなさい」など記述式にしてください。
- 出題ジャンルは果物、人物、地名、動物、歴史上の出来事など幅広く構いません。
- 各問題において、出題文・ヒント・正解のすべては実在の事実に基づき、互いに矛盾しないようにしてください。
- 特に人物、歴史、作品、地名などの情報は、事実として確認できる内容のみを使用し、架空の情報や誤った情報、矛盾した情報を絶対に含めないでください。
- 明らかに誤った生没年や代表作、出身地などを組み合わせた出題をしないでください。

【ヒント・回答処理ルール】
- ユーザーが「ヒント」と入力した場合、それは回答ではなくヒント要求とみなし、その問題に関する追加のヒントを1つだけ返してください。
- ヒントは1問につき最大3回までとし、4回目以降に「ヒント」と入力された場合はその問題は打ち切りとし、正解を発表して次の問題に進んでください。
- ユーザーが「ヒント」と入力しても、「ヒント は不正解です」などの判定は絶対に返さないでください。
- ユーザーが「ヒント」以外のテキストを入力した場合、それは「回答」とみなし、正誤判定を行ってください。
  - 正解の場合は「正解です！」と伝え、すぐに次の問題へ進んでください。
  - 不正解の場合は「不正解です。もう一度答えてください。」と伝えてください。ヒント希望の可能性もあるため、ヒントも促す文言を追加しても構いません。

【ヒントの出し方】
- 最初の出題文はとても難しくしてください。すぐに答えがわからないような情報にしてください（例：その果物の100gあたりの栄養素、ある人物の生没年や出身地のみ、など）。
- ヒント1〜3は徐々に具体性を増すようにしてください。ヒント3ではかなり答えに近い情報を出してもかまいません。

【終了処理】
- 3問すべて出題し終えたら「クイズ終了！」と必ず表示し、最後にお別れのあいさつ文を入れて追加の問題は絶対に出題しないでください。
        `}
    ];
    saveMessagesToFirebase();
  }
  
  currentQuestion = 1;
  processedAnswers.clear();
  // 3. 「最初の問題」をAIに渡す（チャット欄には表示しない）
  addUserMessage("最初の問題");
  sendToLambda();
}



// ルーム入室・作成ダイアログ
async function showRoomEntry() {
  clearChat();
  userInput.disabled = true;
  sendBtn.disabled = true;
  hintBtn.disabled = true;
  roomStatus.innerHTML = "ルーム情報を取得中...";
  
  // リセット処理
  quizEnded = false;
  currentQuestion = 1;
  processedAnswers.clear();
  
  // 既存の購読をクリーンアップ
  if (chatUnsubscribe) chatUnsubscribe();
  if (partUnsubscribe) partUnsubscribe();
  if (scoresUnsubscribe) scoresUnsubscribe();
  if (quizEndUnsubscribe) quizEndUnsubscribe();


  // まず自分が既に参加中のルームがあるかチェック
  const myRoom = await findMyParticipatingRoom();
  if (myRoom) {
    // 既に参加中のルームがある場合は復帰
    roomId = myRoom.roomId;
    userId = myRoom.userId;
    displayName = myRoom.userName;
    isOwner = myRoom.isOwner;
    score = 0;

    get(ref(db, `chatlogs/${roomId}`)).then(snapshot => {
      messages = snapshot.val() || [];
      subscribeChat();
      subscribeParticipantsAndScores();
      subscribeQuizEnd();
      
      const statusText = isOwner ? "あなたはルームオーナー" : "ルームに復帰しました";
      roomStatus.innerHTML = `
        <div class="active-room-card">
          <div class="active-room-info">
            <span class="room-status">${statusText}</span>
          </div>
          <button id="resetRoomBtn" class="reset-room-btn">リセット</button>
        </div>
      `;
      userInput.disabled = false;
      sendBtn.disabled = false;
      hintBtn.disabled = false;
      
       // リセットボタンのイベントリスナー
      document.getElementById('resetRoomBtn').onclick = async () => {
        if (confirm("本当にリセットしますか？")) {
          // rooms/${roomId}/isActive を false に更新
          await update(ref(db, `rooms/${roomId}`), { isActive: false });
          location.reload();
        }
      };

      // オーナーで初回の場合はクイズ開始
      if (isOwner && !messages.length) startQuiz();
    });
    return;
  }

  // 既存のルーム処理（参加中でない場合）
  const activeRoom = await getActiveRoom();
  if (activeRoom) {
    isOwner = false;
    // 進行中ルーム案内＋参加ボタンをカード風で表示
    roomStatus.innerHTML = `
      <div class="active-room-card">
        <div class="active-room-info">
          <span class="room-status">現在クイズが進行中です</span>
          <span class="room-owner">（オーナー: <b>${activeRoom.ownerName}</b>）</span>
        </div>
        <button id="joinBtn" class="join-btn">参加する</button>
      </div>
    `;
    document.getElementById('joinBtn').onclick = () => {
      showNameDialog(async (name) => {
        displayName = name;
        userId = await joinRoom(activeRoom.id, name);
        roomId = activeRoom.id;
        score = 0;
        get(ref(db, `chatlogs/${roomId}`)).then(snapshot => {
          messages = snapshot.val() || [];
          subscribeChat();
          subscribeParticipantsAndScores();
          subscribeQuizEnd();
          roomStatus.innerHTML = "";
          userInput.disabled = false;
          sendBtn.disabled = false;
          hintBtn.disabled = false;
        });
      });
    };
  } else {
    isOwner = true;
    // クイズをはじめるボタンを大きく目立たせる
    roomStatus.innerHTML = `
      <button id="startQuizBtn" class="start-quiz-btn">クイズをはじめる</button>
    `;
    document.getElementById('startQuizBtn').onclick = () => {
      showNameDialog(async (name) => {
        // 参加直前にも進行中のルームがないか再チェック（複数ルームが同時に作成されないよう制御）
        const roomsRef = ref(db, "rooms");
        const q = query(roomsRef, orderByChild("isActive"), equalTo(true));
        const latestSnapshot = await get(q);
        if (latestSnapshot.exists()) {
          alert("他のユーザーが先にクイズを開始しました。ページをリロードしてください。");
          location.reload();
          return;
        }

        displayName = name;
        userId = generateUserId();
        roomId = await createRoom(name);
        score = 0;
        messages = [];
        subscribeChat();
        subscribeParticipantsAndScores();
        subscribeQuizEnd();
        roomStatus.innerHTML = "";
        userInput.disabled = false;
        sendBtn.disabled = false;
        hintBtn.disabled = false;
        await joinRoom(roomId, name);
        startQuiz();
      });
    };
  }
}

// Firebase匿名認証
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("Already login:", user);
    myUid = user.uid;
    console.log("myUid:", myUid);
    showRoomEntry();
  } else {
    console.log("Login start:", user);
    signInAnonymously(auth);
  }
});