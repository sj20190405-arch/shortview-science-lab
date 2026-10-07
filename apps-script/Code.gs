/**
 * 한슬쌤의 '숏'터뷰 통합과학실험실 — 구글 드라이브 성적관리 (Apps Script)
 * 동패고등학교 1학년 통합과학 (Ⅰ-2-01 산화·환원 반응의 규칙성)
 *
 * 이 스크립트를 붙인 구글 시트가 곧 '성적관리 파일'입니다.
 *   ├─ 성적표      : 학생별 단계·세부 점수와 총점 (④ 교사확정 칸을 직접 고칠 수 있음)
 *   ├─ 보고서      : 학생별 결과보고서 답안과 관찰 기록
 *   ├─ 반별 통계   : 반별 참여 인원·제출 인원·단계별 평균 (자동 계산)
 *   └─ 학생기록    : 웹 페이지와 주고받는 원본 데이터 (수정하지 마세요)
 *
 * 설치 방법은 저장소의 README.md를 보세요.
 * 교사 비밀번호는 코드에 적지 않습니다. 시트 메뉴 [🧪 가상실험실 → 교사 비밀번호 바꾸기]에서 정합니다.
 */

const SH_RAW = '학생기록', SH_GRADE = '성적표', SH_REPORT = '보고서', SH_STAT = '반별 통계';
const ST = ['시작 전', '진행 중', '완료'];
const TPTS = [0, 2, 5, 10, 20];
const COLOR_N = { c0: '무색', c1: '연한 하늘색', c2: '푸른색', c3: '진한 푸른색', cx: '연한 갈색' };
const SURF_N = { s0: '변화 없음', s1: '은백색 금속 조금 석출', s2: '나뭇가지 모양 은 결정', sx1: '검게 녹슴', sx2: '기포 발생' };
const SHAPE_N = { spiral: '나선', heart: '하트', zigzag: '지그재그' };
const CLASS_COUNT = 13;

const RAW_H = ['키', '반', '번호', '성명', '현재 단계',
  '1단계 상태', '1단계 기초이론(20)', '2단계 상태', '2단계 실험준비(20)',
  '3단계 상태', '3단계 가상실험(40)', '4단계 상태', '4단계 자동채점(20)', '4단계 교사확정(20)',
  '총점(100)', '시작', '최근 활동', '보고서 제출', '상세(JSON)'];
const GRADE_H = ['반', '번호', '성명',
  '① 기초이론\n(20)',
  '② 도구\n(5)', '② 보호구\n(4)', '② 안전OX\n(7)', '② 순서\n(4)', '② 실험준비\n(20)',
  '③ 조작\n(10)', '③ 관찰\n(10)', '③ 입자모형\n(12)', '③ 반응식\n(8)', '③ 가상실험\n(40)',
  '④ 자동채점\n(20)', '④ 교사확정\n(20)', '④ 결과보고서\n(20)',
  '총점\n(100)', '진행 상태', '보고서 제출', '최근 활동', '키'];
const G_TEACHER = 16, G_KEY = 22;                 // 성적표: 교사확정 열, 키 열
const REPORT_H = ['반', '번호', '성명', '제출 시각', '구리줄 모양', '용액(mL)',
  '관찰 0분', '관찰 2분', '관찰 5분', '관찰 10분', '관찰 20분',
  'Q1 수용액이 푸른색이 된 까닭', 'Q2 석출된 물질과 까닭', 'Q3 산화·환원이 동시인 까닭',
  'Q4 선택', 'Q4 까닭', 'Q5 생활 속 산화·환원',
  '④ 자동채점(20)', '④ 교사확정(20)', '키'];
const R_TEACHER = 19, R_KEY = 20;                 // 보고서: 교사확정 열, 키 열

/* ======================= 웹 페이지 연결 ======================= */

function doGet() {
  try {
    return HtmlService.createHtmlOutputFromFile('index')
      .setTitle("한슬쌤의 '숏'터뷰 통합과학실험실")
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (e) {
    return ContentService.createTextOutput("한슬쌤의 '숏'터뷰 통합과학실험실 성적관리 서버 작동 중");
  }
}

const API_FUNCS = { saveRecord: saveRecord, loadStudent: loadStudent, getTeacherData: getTeacherData, setReportScore: setReportScore };
function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const fn = API_FUNCS[req.action];
    if (!fn) throw new Error('알 수 없는 요청입니다.');
    out = { result: fn.apply(null, req.args || []) };
  } catch (err) {
    out = { error: err && err.message ? err.message : String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function teacherPw_() {
  const pw = PropertiesService.getScriptProperties().getProperty('TEACHER_PW');
  if (!pw) throw new Error('교사 비밀번호가 아직 설정되지 않았습니다. 시트 메뉴 [🧪 가상실험실 → 교사 비밀번호 바꾸기]에서 정해 주세요.');
  return String(pw);
}
function clean_(s) { return String(s || '').replace(/[^가-힣a-zA-Z()]/g, '').slice(0, 20); }

/** 학생 기록 저장(있으면 갱신). 교사 확정 점수는 학생이 덮어쓸 수 없음. */
function saveRecord(json) {
  const r = JSON.parse(json);
  r.cls = Number(r.cls); r.num = Number(r.num); r.name = clean_(r.name);
  if (!(r.cls >= 1 && r.cls <= 20 && r.num >= 1 && r.num <= 50 && r.name.length >= 2)) throw new Error('학생 정보 오류');
  r.key = r.cls + '-' + r.num + '-' + r.name;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = raw_();
    const row = findRow_(sh, 1, r.key);
    r.updatedAt = new Date().toISOString();
    if (row > 0) {
      const old = JSON.parse(sh.getRange(row, RAW_H.length).getValue() || '{}');
      if (old.st && old.st[3] === 2) {        // 제출한 보고서는 바뀌지 않게 보호 (다른 단계는 계속 진행 가능)
        r.st[3] = 2; r.d = r.d || {}; r.d.s4 = old.d && old.d.s4; r.rAuto = old.rAuto; r.sc[3] = old.sc[3]; r.submittedAt = old.submittedAt;
      }
      r.rTeacher = old.rTeacher != null ? old.rTeacher : null;
      if (old.startedAt) r.startedAt = old.startedAt;
      if (old.submittedAt && !r.submittedAt) r.submittedAt = old.submittedAt;
    } else {
      r.rTeacher = null;
    }
    writeAll_(r, row);
    return JSON.stringify({ ok: true, updatedAt: r.updatedAt });
  } finally {
    lock.releaseLock();
  }
}

/** 같은 반·번호·성명으로 다시 들어오면 이어서 진행 */
function loadStudent(cls, num, name) {
  const r = readRec_(Number(cls) + '-' + Number(num) + '-' + clean_(name));
  if (!r) return null;
  delete r.rTeacher;           // 학생에게는 교사 점수를 돌려주지 않음
  return JSON.stringify(r);
}

/** 교사 현황판 데이터 (비밀번호 확인 후에만) */
function getTeacherData(pw) {
  if (String(pw) !== teacherPw_()) throw new Error('비밀번호가 맞지 않습니다.');
  return JSON.stringify({ records: allRecs_(), sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() });
}

/** 결과보고서 점수 교사 확정 (0~20, 1점 단위) — 교사 화면에서 호출 */
function setReportScore(pw, key, score) {
  if (String(pw) !== teacherPw_()) throw new Error('권한이 없습니다.');
  const v = Math.round(Number(score));
  if (!(v >= 0 && v <= 20)) throw new Error('0~20점 사이로 입력하세요.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { applyTeacherScore_(key, v); } finally { lock.releaseLock(); }
  return JSON.stringify({ ok: true });
}

/* ======================= 시트 쓰기 ======================= */

function sheet_(name, headers, color) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground(color || '#0A141C').setFontColor('#FFFFFF')
      .setWrap(true).setVerticalAlignment('middle').setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 44);
  }
  return sh;
}
function raw_() {
  const sh = sheet_(SH_RAW, RAW_H, '#5A6A76');
  return sh;
}
function grade_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const isNew = !ss.getSheetByName(SH_GRADE);
  const sh = sheet_(SH_GRADE, GRADE_H);
  if (isNew) formatGrade_(sh);
  return sh;
}
function report_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const isNew = !ss.getSheetByName(SH_REPORT);
  const sh = sheet_(SH_REPORT, REPORT_H, '#C8004A');
  if (isNew) {
    sh.setFrozenColumns(3);
    sh.setColumnWidths(12, 6, 260);
    sh.getRange(1, R_TEACHER).setBackground('#D98A00');
    sh.getRange(2, R_TEACHER, sh.getMaxRows() - 1, 1).setBackground('#FFF4D6');
    sh.hideColumns(R_KEY);
  }
  return sh;
}
function formatGrade_(sh) {
  sh.setFrozenColumns(3);
  const head = sh.getRange(1, 1, 1, GRADE_H.length);
  head.setBackground('#0A141C');
  sh.getRange(1, 4).setBackground('#12959E');
  sh.getRange(1, 5, 1, 5).setBackground('#D98A00');
  sh.getRange(1, 10, 1, 5).setBackground('#2F6FE8');
  sh.getRange(1, 15, 1, 3).setBackground('#C8004A');
  sh.getRange(1, 18).setBackground('#0A141C');
  sh.getRange(1, G_TEACHER).setValue('④ 교사확정\n(20) ✎');
  sh.getRange(2, G_TEACHER, sh.getMaxRows() - 1, 1).setBackground('#FFF4D6');
  sh.getRange(1, G_TEACHER).setNote('결과보고서 점수를 0~20 사이 정수로 입력하면 총점과 교사 화면에 바로 반영됩니다. 비우면 자동채점 점수가 쓰입니다.');
  [9, 14, 17, 18].forEach(function (c) { sh.getRange(2, c, sh.getMaxRows() - 1, 1).setFontWeight('bold'); });
  sh.setColumnWidths(1, 2, 44); sh.setColumnWidth(3, 80);
  sh.setColumnWidths(4, 15, 74);
  sh.setColumnWidth(19, 150); sh.setColumnWidths(20, 2, 130);
  sh.getRange(2, 1, sh.getMaxRows() - 1, 18).setHorizontalAlignment('center');
  sh.hideColumns(G_KEY);
}

function findRow_(sh, col, key) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const keys = sh.getRange(2, col, last - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) if (String(keys[i][0]) === key) return i + 2;
  return -1;
}
function readRec_(key) {
  const sh = raw_();
  const row = findRow_(sh, 1, key);
  if (row < 0) return null;
  return JSON.parse(sh.getRange(row, RAW_H.length).getValue());
}
function allRecs_() {
  const sh = raw_();
  const last = sh.getLastRow();
  const out = [];
  if (last >= 2) sh.getRange(2, RAW_H.length, last - 1, 1).getValues().forEach(function (v) {
    try { out.push(JSON.parse(v[0])); } catch (e) {}
  });
  return out;
}

function n_(v) { return v == null || v === '' ? 0 : Number(v); }
function report4_(r) { return r.st[3] === 2 ? (r.rTeacher != null ? r.rTeacher : n_(r.rAuto)) : 0; }
function total_(r) { return n_(r.sc[0]) + n_(r.sc[1]) + n_(r.sc[2]) + report4_(r); }
function kst_(iso) { return iso ? Utilities.formatDate(new Date(iso), 'Asia/Seoul', 'MM-dd HH:mm') : ''; }
function progress_(r) { return r.st.map(function (s, i) { return '①②③④'[i] + (s === 2 ? '완료' : s === 1 ? '진행' : '-'); }).join(' '); }

function rawRow_(r) {
  return [r.key, r.cls, r.num, r.name, r.cur > 4 ? '모두 완료' : r.cur + '단계',
    ST[r.st[0]], r.sc[0], ST[r.st[1]], r.sc[1], ST[r.st[2]], r.sc[2],
    ST[r.st[3]], r.st[3] === 2 ? r.rAuto : '', r.rTeacher != null ? r.rTeacher : '',
    total_(r), r.startedAt || '', r.updatedAt || '', r.submittedAt || '', JSON.stringify(r)];
}
function gradeRow_(r) {
  const d2 = (r.d && r.d.s2 && r.d.s2.part) || {}, d3 = (r.d && r.d.s3) || {};
  const s2 = function (k) { return d2[k] == null ? '' : d2[k]; };
  const op = (d3.safety || 0) + (d3.sand || 0) + (d3.place || 0) + (d3.pour || 0);
  const anyOp = d3.safety != null || d3.sand != null || d3.place != null || d3.pour != null;
  return [r.cls, r.num, r.name,
    r.st[0] === 0 ? '' : n_(r.sc[0]),
    s2('tools'), s2('ppe'), s2('ox'), s2('order'), r.st[1] === 2 ? n_(r.sc[1]) : '',
    anyOp ? op : '', d3.obsScore == null ? '' : d3.obsScore, d3.partScore == null ? '' : d3.partScore, d3.eqScore == null ? '' : d3.eqScore,
    r.st[2] === 0 ? '' : n_(r.sc[2]),
    r.st[3] === 2 ? n_(r.rAuto) : '', r.rTeacher != null ? r.rTeacher : '', r.st[3] === 2 ? report4_(r) : '',
    total_(r), progress_(r), kst_(r.submittedAt), kst_(r.updatedAt), r.key];
}
function reportRow_(r) {
  const d3 = (r.d && r.d.s3) || {}, d4 = (r.d && r.d.s4) || {}, a = d4.ans || {}, obs = d3.obs || {};
  const ob = TPTS.map(function (t) { const o = obs[t] || {}; return (COLOR_N[o.c] || '-') + ' / ' + (SURF_N[o.s] || '-'); });
  return [r.cls, r.num, r.name, kst_(r.submittedAt), SHAPE_N[d3.shape] || '', d3.vol || '']
    .concat(ob)
    .concat([a.q1 || '', a.q2 || '', a.q3 || '', a.q4c === 1 ? '반응이 일어나지 않는다' : a.q4c === 0 ? '구리가 석출된다' : '', a.q4 || '', a.q5 || '',
      r.rAuto == null ? '' : r.rAuto, r.rTeacher != null ? r.rTeacher : '', r.key]);
}
function upsert_(sh, keyCol, key, row) {
  const at = findRow_(sh, keyCol, key);
  if (at > 0) sh.getRange(at, 1, 1, row.length).setValues([row]);
  else sh.getRange(Math.max(sh.getLastRow(), 1) + 1, 1, 1, row.length).setValues([row]);
}
function writeAll_(r, rawRowAt) {
  const raw = raw_();
  if (rawRowAt > 0) raw.getRange(rawRowAt, 1, 1, RAW_H.length).setValues([rawRow_(r)]);
  else raw.appendRow(rawRow_(r));
  upsert_(grade_(), G_KEY, r.key, gradeRow_(r));
  if (r.st[3] === 2) upsert_(report_(), R_KEY, r.key, reportRow_(r));
}
function applyTeacherScore_(key, v) {
  const r = readRec_(key);
  if (!r) throw new Error('학생 기록을 찾을 수 없습니다.');
  r.rTeacher = v;
  writeAll_(r, findRow_(raw_(), 1, key));
}

/* ======================= 시트에서 직접 성적 관리 ======================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🧪 가상실험실')
    .addItem('처음 설정하기', 'setupLab')
    .addItem('교사 비밀번호 바꾸기', 'setPassword')
    .addSeparator()
    .addItem('성적표·보고서 반/번호순으로 다시 정리', 'rebuildSheets')
    .addItem('반별 통계 새로 만들기', 'buildStats')
    .addSeparator()
    .addItem('선택한 학생 기록 삭제', 'deleteSelected')
    .addItem('모든 학생 기록 초기화', 'resetAll')
    .addToUi();
}

/** 성적표·보고서의 '④ 교사확정' 칸을 고치면 원본·총점·교사 화면에 반영 */
function onEdit(e) {
  try {
    const sh = e.range.getSheet(), name = sh.getName();
    const col = e.range.getColumn(), row = e.range.getRow();
    if (row < 2 || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
    let keyCol;
    if (name === SH_GRADE && col === G_TEACHER) keyCol = G_KEY;
    else if (name === SH_REPORT && col === R_TEACHER) keyCol = R_KEY;
    else return;
    const key = String(sh.getRange(row, keyCol).getValue());
    if (!key) return;
    const raw = e.range.getValue();
    const r = readRec_(key);
    if (!r) return;
    if (raw === '' || raw == null) {
      r.rTeacher = null;
    } else {
      const v = Number(raw);
      if (!(v >= 0 && v <= 20 && Math.round(v) === v)) {
        e.range.setValue(e.oldValue == null ? '' : e.oldValue);
        SpreadsheetApp.getActiveSpreadsheet().toast('0~20 사이의 정수만 입력할 수 있어요.', '입력 확인', 4);
        return;
      }
      if (r.st[3] !== 2) {
        e.range.setValue(e.oldValue == null ? '' : e.oldValue);
        SpreadsheetApp.getActiveSpreadsheet().toast(r.name + ' 학생은 아직 결과보고서를 제출하지 않았어요.', '입력 확인', 4);
        return;
      }
      r.rTeacher = v;
    }
    writeAll_(r, findRow_(raw_(), 1, key));
    SpreadsheetApp.getActiveSpreadsheet().toast(r.name + ' 결과보고서 ' + (r.rTeacher == null ? '자동채점 ' + n_(r.rAuto) : r.rTeacher) + '점 반영 · 총점 ' + total_(r) + '점', '성적 반영', 4);
  } catch (err) {
    SpreadsheetApp.getActiveSpreadsheet().toast(String(err.message || err), '오류', 6);
  }
}

function setupLab() {
  raw_(); grade_(); report_(); buildStats(true);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setActiveSheet(ss.getSheetByName(SH_GRADE));
  ss.moveActiveSheet(1);
  const def = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  if (!PropertiesService.getScriptProperties().getProperty('TEACHER_PW')) setPassword();
  SpreadsheetApp.getUi().alert('설정 완료',
    '성적표 · 보고서 · 반별 통계 · 학생기록 시트를 만들었습니다.\n\n다음 단계: Apps Script 화면에서 [배포 → 새 배포 → 웹 앱]으로 배포하고, 나온 주소를 GitHub의 config.js에 붙여 넣으세요.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function setPassword() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('교사 비밀번호', '교사 화면에 들어갈 때 쓸 비밀번호를 입력하세요. (예: 0601)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const pw = res.getResponseText().trim();
  if (pw.length < 4) { ui.alert('비밀번호는 4자 이상으로 정해 주세요.'); return; }
  PropertiesService.getScriptProperties().setProperty('TEACHER_PW', pw);
  ui.alert('교사 비밀번호를 저장했습니다.');
}

function rebuildSheets() {
  const recs = allRecs_().sort(function (a, b) { return a.cls - b.cls || a.num - b.num; });
  const g = grade_(), rp = report_();
  if (g.getLastRow() > 1) g.getRange(2, 1, g.getLastRow() - 1, GRADE_H.length).clearContent();
  if (rp.getLastRow() > 1) rp.getRange(2, 1, rp.getLastRow() - 1, REPORT_H.length).clearContent();
  if (recs.length) g.getRange(2, 1, recs.length, GRADE_H.length).setValues(recs.map(gradeRow_));
  const subs = recs.filter(function (r) { return r.st[3] === 2; });
  if (subs.length) rp.getRange(2, 1, subs.length, REPORT_H.length).setValues(subs.map(reportRow_));
  SpreadsheetApp.getActiveSpreadsheet().toast('학생 ' + recs.length + '명, 보고서 ' + subs.length + '건을 반·번호순으로 정리했습니다.', '정리 완료', 4);
}

function buildStats(silent) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SH_STAT);
  if (sh) sh.clear(); else sh = ss.insertSheet(SH_STAT);
  const H = ['반', '참여 인원', '보고서 제출', '① 기초이론 평균(20)', '② 실험준비 평균(20)', '③ 가상실험 평균(40)', '④ 결과보고서 평균(20)', '총점 평균(100)', '총점 최고', '총점 최저'];
  sh.getRange(1, 1, 1, H.length).setValues([H]).setFontWeight('bold').setBackground('#0A141C').setFontColor('#fff').setWrap(true).setHorizontalAlignment('center');
  const G = "'" + SH_GRADE + "'!";
  const rows = [];
  for (let c = 1; c <= CLASS_COUNT; c++) {
    const r = c + 1;
    rows.push([c + '반',
      '=COUNTIF(' + G + 'A:A,' + c + ')',
      '=COUNTIFS(' + G + 'A:A,' + c + ',' + G + 'T:T,"<>")',
      '=IFERROR(ROUND(AVERAGEIFS(' + G + 'D:D,' + G + 'A:A,' + c + ',' + G + 'D:D,"<>"),1),"-")',
      '=IFERROR(ROUND(AVERAGEIFS(' + G + 'I:I,' + G + 'A:A,' + c + ',' + G + 'I:I,"<>"),1),"-")',
      '=IFERROR(ROUND(AVERAGEIFS(' + G + 'N:N,' + G + 'A:A,' + c + ',' + G + 'N:N,"<>"),1),"-")',
      '=IFERROR(ROUND(AVERAGEIFS(' + G + 'Q:Q,' + G + 'A:A,' + c + ',' + G + 'Q:Q,"<>"),1),"-")',
      '=IFERROR(ROUND(AVERAGEIFS(' + G + 'R:R,' + G + 'A:A,' + c + ',' + G + 'T:T,"<>"),1),"-")',
      '=IFERROR(MAXIFS(' + G + 'R:R,' + G + 'A:A,' + c + ',' + G + 'T:T,"<>"),"-")',
      '=IFERROR(MINIFS(' + G + 'R:R,' + G + 'A:A,' + c + ',' + G + 'T:T,"<>"),"-")']);
  }
  const L = CLASS_COUNT + 1;
  rows.push(['전체', '=SUM(B2:B' + L + ')', '=SUM(C2:C' + L + ')',
    '=IFERROR(ROUND(AVERAGE(' + G + 'D2:D),1),"-")', '=IFERROR(ROUND(AVERAGE(' + G + 'I2:I),1),"-")',
    '=IFERROR(ROUND(AVERAGE(' + G + 'N2:N),1),"-")', '=IFERROR(ROUND(AVERAGE(' + G + 'Q2:Q),1),"-")',
    '=IFERROR(ROUND(AVERAGEIFS(' + G + 'R:R,' + G + 'T:T,"<>"),1),"-")',
    '=IFERROR(MAXIFS(' + G + 'R:R,' + G + 'T:T,"<>"),"-")', '=IFERROR(MINIFS(' + G + 'R:R,' + G + 'T:T,"<>"),"-")']);
  sh.getRange(2, 1, rows.length, H.length).setFormulas(rows.map(function (r) { return r.map(function (v) { return String(v).charAt(0) === '=' ? v : ''; }); }));
  sh.getRange(2, 1, rows.length, 1).setValues(rows.map(function (r) { return [r[0]]; }));
  sh.getRange(rows.length + 1, 1, 1, H.length).setFontWeight('bold').setBackground('#E2F5EC');
  sh.getRange(2, 1, rows.length, H.length).setHorizontalAlignment('center');
  sh.setFrozenRows(1); sh.setRowHeight(1, 44); sh.setColumnWidths(1, H.length, 96);
  sh.getRange(rows.length + 3, 1).setValue('※ 총점 평균·최고·최저는 결과보고서를 제출한 학생만 계산합니다. 성적표가 바뀌면 자동으로 다시 계산됩니다.').setFontColor('#5A6A76');
  if (silent !== true) ss.toast('반별 통계를 새로 만들었습니다.', '완료', 3);
}

function deleteSelected() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet(), name = sh.getName(), row = sh.getActiveRange().getRow();
  const keyCol = name === SH_GRADE ? G_KEY : name === SH_REPORT ? R_KEY : name === SH_RAW ? 1 : 0;
  if (!keyCol || row < 2) { ui.alert('성적표(또는 보고서) 시트에서 지울 학생의 줄을 하나 선택한 뒤 다시 실행하세요.'); return; }
  const key = String(sh.getRange(row, keyCol).getValue());
  if (!key) { ui.alert('선택한 줄에 학생 기록이 없습니다.'); return; }
  const ok = ui.alert('학생 기록 삭제', key.replace(/-/g, ' ') + ' 학생의 모든 기록(점수·보고서)을 삭제할까요?\n삭제 후 학생이 같은 정보로 들어오면 처음부터 다시 시작합니다.', ui.ButtonSet.YES_NO);
  if (ok !== ui.Button.YES) return;
  [[raw_(), 1], [grade_(), G_KEY], [report_(), R_KEY]].forEach(function (p) {
    const at = findRow_(p[0], p[1], key);
    if (at > 0) p[0].deleteRow(at);
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('삭제했습니다.', '완료', 3);
}

function resetAll() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('모든 학생 기록 초기화', '모든 학생의 점수와 보고서를 지웁니다. 되돌릴 수 없어요. 계속할까요?\n(필요하면 먼저 [파일 → 사본 만들기]로 백업하세요.)', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const res = ui.prompt('한 번 더 확인', '정말 지우려면 "초기화"라고 입력하세요.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK || res.getResponseText().trim() !== '초기화') { ui.alert('취소했습니다.'); return; }
  [raw_(), grade_(), report_()].forEach(function (sh) {
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('모든 학생 기록을 초기화했습니다.', '완료', 4);
}
