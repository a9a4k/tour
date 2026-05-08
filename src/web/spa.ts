export function html(initialReviewId?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #c9d1d9; display: flex; height: 100vh; }
  #sidebar { width: 280px; border-right: 1px solid #30363d; overflow-y: auto; flex-shrink: 0; }
  #sidebar h2 { padding: 12px 16px; font-size: 14px; color: #8b949e; border-bottom: 1px solid #30363d; }
  .file-entry { padding: 8px 16px; cursor: pointer; font-size: 13px; display: flex; align-items: center; gap: 8px; }
  .file-entry:hover { background: #161b22; }
  .file-entry.selected { background: #1f6feb33; border-left: 2px solid #58a6ff; }
  .file-icon { width: 16px; text-align: center; font-weight: bold; font-size: 11px; }
  .file-icon.A { color: #3fb950; }
  .file-icon.M { color: #d29922; }
  .file-icon.D { color: #f85149; }
  .file-icon.R { color: #a371f7; }
  .badge { background: #30363d; color: #8b949e; border-radius: 10px; padding: 1px 6px; font-size: 11px; margin-left: auto; }
  #main { flex: 1; overflow-y: auto; padding: 16px; }
  .banner { background: #d292221a; border: 1px solid #d29922; color: #d29922; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; }
  .review-header { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #30363d; }
  .review-header h1 { font-size: 20px; margin-bottom: 4px; }
  .review-header .meta { color: #8b949e; font-size: 13px; }
  .file-diff { margin-bottom: 24px; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
  .file-diff-header { background: #161b22; padding: 8px 16px; font-size: 13px; font-weight: 600; border-bottom: 1px solid #30363d; }
  .diff-table { width: 100%; border-collapse: collapse; font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; line-height: 20px; }
  .diff-table td { padding: 0 12px; white-space: pre-wrap; word-break: break-all; vertical-align: top; }
  .diff-table .line-num { color: #484f58; text-align: right; width: 50px; user-select: none; border-right: 1px solid #30363d; padding-right: 8px; }
  .diff-table tr.addition { background: #12261e; }
  .diff-table tr.addition .line-num { background: #0c3a2a; }
  .diff-table tr.deletion { background: #2d1214; }
  .diff-table tr.deletion .line-num { background: #3c1618; }
  .diff-table tr.context { background: transparent; }
  .annotation-block { background: #1c2128; border-left: 3px solid #58a6ff; margin: 4px 16px 4px 60px; padding: 8px 12px; border-radius: 4px; font-size: 12px; }
  .annotation-block .ann-header { color: #58a6ff; font-weight: 600; margin-bottom: 4px; font-size: 11px; }
  .annotation-block .ann-body { color: #c9d1d9; }
  .no-reviews { text-align: center; padding: 48px; color: #8b949e; }
  #review-list { display: none; }
  #review-list.visible { display: block; }
  .review-item { padding: 12px 16px; border-bottom: 1px solid #30363d; cursor: pointer; }
  .review-item:hover { background: #161b22; }
  .review-item .title { font-weight: 600; }
  .review-item .id { color: #8b949e; font-size: 12px; }
</style>
</head>
<body>
<div id="sidebar">
  <h2>Files</h2>
  <div id="file-list"></div>
</div>
<div id="main">
  <div id="content"></div>
</div>
<script>
const INITIAL_ID = ${initialReviewId ? JSON.stringify(initialReviewId) : "null"};
let currentReview = null;
let currentData = null;

async function loadReviews() {
  const res = await fetch('/api/reviews?status=all');
  return res.json();
}

async function loadReview(id) {
  const res = await fetch('/api/reviews/' + id);
  return res.json();
}

function fileTypeIcon(type) {
  switch (type) {
    case 'new': case 'add': return 'A';
    case 'delete': return 'D';
    case 'rename': return 'R';
    default: return 'M';
  }
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderSidebar(data) {
  const fileList = document.getElementById('file-list');
  if (!data.diffModel || !data.diffModel.files) {
    fileList.innerHTML = '<div class="no-reviews">No files</div>';
    return;
  }
  const files = [...data.diffModel.files].sort((a, b) => a.name.localeCompare(b.name));
  fileList.innerHTML = files.map((f, i) => {
    const icon = fileTypeIcon(f.type);
    const annCount = (data.annotations || []).filter(a => a.file === f.name).length;
    const badge = annCount > 0 ? '<span class="badge">' + annCount + '</span>' : '';
    return '<div class="file-entry" data-idx="' + i + '" onclick="scrollToFile(' + i + ')">' +
      '<span class="file-icon ' + icon + '">' + icon + '</span>' +
      '<span>' + escapeHtml(f.name) + '</span>' + badge + '</div>';
  }).join('');
}

function renderDiff(data) {
  const content = document.getElementById('content');
  let html = '';

  html += '<div class="review-header">';
  html += '<h1>' + escapeHtml(data.title || data.id) + '</h1>';
  html += '<div class="meta">' + data.status + ' &middot; ' + data.id + ' &middot; ' + data.created_at + '</div>';
  html += '</div>';

  if (data.snapshotLost) {
    html += '<div class="banner">Snapshot lost — annotations preserved but diff cannot be displayed</div>';
  }

  if (data.diff) {
    const lines = data.diff.split('\\n');
    let currentFile = null;
    let leftNum = 0, rightNum = 0;
    const annotations = data.annotations || [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('diff --git')) {
        if (currentFile) html += '</table></div>';
        const match = line.match(/b\\/(.+)$/);
        const name = match ? match[1] : 'unknown';
        currentFile = name;
        html += '<div class="file-diff" id="file-' + escapeHtml(name) + '">';
        html += '<div class="file-diff-header">' + escapeHtml(name) + '</div>';
        html += '<table class="diff-table">';
        continue;
      }
      if (line.startsWith('@@')) {
        const hunkMatch = line.match(/@@ -(\\d+),?\\d* \\+(\\d+),?\\d* @@/);
        if (hunkMatch) { leftNum = parseInt(hunkMatch[1]); rightNum = parseInt(hunkMatch[2]); }
        html += '<tr class="context"><td class="line-num" colspan="2"></td><td style="color:#58a6ff">' + escapeHtml(line) + '</td></tr>';
        continue;
      }
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) continue;
      if (!currentFile) continue;

      if (line.startsWith('+')) {
        html += '<tr class="addition"><td class="line-num"></td><td class="line-num">' + rightNum + '</td><td>' + escapeHtml(line.slice(1)) + '</td></tr>';
        const fileAnns = annotations.filter(a => a.file === currentFile && a.side === 'additions' && rightNum >= a.line_start && rightNum <= a.line_end);
        for (const ann of fileAnns) {
          html += '<tr><td colspan="3"><div class="annotation-block"><div class="ann-header">' +
            escapeHtml(ann.author) + ' &middot; ' + ann.file + ':' + ann.line_start +
            (ann.line_start !== ann.line_end ? '-' + ann.line_end : '') +
            '</div><div class="ann-body">' + escapeHtml(ann.body) + '</div></div></td></tr>';
        }
        rightNum++;
      } else if (line.startsWith('-')) {
        html += '<tr class="deletion"><td class="line-num">' + leftNum + '</td><td class="line-num"></td><td>' + escapeHtml(line.slice(1)) + '</td></tr>';
        const fileAnns = annotations.filter(a => a.file === currentFile && a.side === 'deletions' && leftNum >= a.line_start && leftNum <= a.line_end);
        for (const ann of fileAnns) {
          html += '<tr><td colspan="3"><div class="annotation-block"><div class="ann-header">' +
            escapeHtml(ann.author) + ' &middot; ' + ann.file + ':' + ann.line_start +
            (ann.line_start !== ann.line_end ? '-' + ann.line_end : '') +
            '</div><div class="ann-body">' + escapeHtml(ann.body) + '</div></div></td></tr>';
        }
        leftNum++;
      } else {
        html += '<tr class="context"><td class="line-num">' + leftNum + '</td><td class="line-num">' + rightNum + '</td><td>' + escapeHtml(line.startsWith(' ') ? line.slice(1) : line) + '</td></tr>';
        leftNum++; rightNum++;
      }
    }
    if (currentFile) html += '</table></div>';
  }

  if (!data.diff && annotations.length > 0) {
    html += '<h2 style="margin: 16px 0">Annotations</h2>';
    for (const ann of annotations) {
      html += '<div class="annotation-block" style="margin-left:0"><div class="ann-header">' +
        escapeHtml(ann.author) + ' &middot; ' + ann.file + ':' + ann.line_start +
        '</div><div class="ann-body">' + escapeHtml(ann.body) + '</div></div>';
    }
  }

  content.innerHTML = html;
}

function scrollToFile(idx) {
  const files = [...currentData.diffModel.files].sort((a, b) => a.name.localeCompare(b.name));
  const file = files[idx];
  if (!file) return;
  const el = document.getElementById('file-' + file.name);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
  document.querySelectorAll('.file-entry').forEach((e, i) => {
    e.classList.toggle('selected', i === idx);
  });
}

async function init() {
  const reviews = await loadReviews();
  if (reviews.length === 0) {
    document.getElementById('content').innerHTML = '<div class="no-reviews">No reviews found. Create one with: review create --head HEAD</div>';
    return;
  }

  let targetId = INITIAL_ID;
  if (!targetId) {
    const open = reviews.filter(r => r.status === 'open');
    targetId = open.length > 0 ? open[open.length - 1].id : reviews[reviews.length - 1].id;
  }

  const data = await loadReview(targetId);
  if (data.error) {
    document.getElementById('content').innerHTML = '<div class="no-reviews">Error: ' + data.error + '</div>';
    return;
  }
  currentData = data;
  currentReview = data;
  renderSidebar(data);
  renderDiff(data);

  const evtSource = new EventSource('/api/reviews/' + targetId + '/events');
  evtSource.onmessage = async function(event) {
    const msg = JSON.parse(event.data);
    if (msg.type === 'annotation-changed') {
      const refreshed = await loadReview(targetId);
      if (!refreshed.error) {
        currentData = refreshed;
        renderSidebar(refreshed);
        renderDiff(refreshed);
      }
    }
  };
}

init();
<\/script>
</body>
</html>`;
}
