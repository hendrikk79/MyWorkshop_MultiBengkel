(function () {
  'use strict';
  const base = 'symbol/';
  const icons = [
    { file: 'CANCLE MAKE.png', keys: ['batal', 'cancel', 'cancle', 'tutup', 'close', 'kembali', '×', '✕', '✖'] },
    { file: 'DELETE.png', keys: ['hapus', 'delete', 'remove', 'delete item'] },
    { file: 'LOGOUT.png', keys: ['keluar', 'logout', 'log out'] },
    { file: 'SAVE.svg', keys: ['simpan', 'save', 'update', 'perbarui'] },
    { file: 'ADD LINE.png', keys: ['tambah', 'buat', 'add', 'create', 'baru', 'new'] },
    { file: 'EDIT.png', keys: ['edit', 'ubah', 'revisi'] },
    { file: 'PRINT.png', keys: ['print', 'cetak', 'cetak pdf'] },
    { file: 'INPUT NOTE.png', keys: ['input', 'isi', 'catat', 'permintaan', 'penerimaan'] },
    { file: 'DETAIL.svg', keys: ['detail', 'lihat detail'] },
    { file: 'HISTORY.png', keys: ['riwayat', 'history', 'log'] },
    { file: 'DOWNLOAD.png', keys: ['download', 'unduh', 'export', 'excel', 'pdf'] },
    { file: 'SEARCH.png', keys: ['cari', 'search', 'filter'] },
    { file: 'UPLOAD.svg', keys: ['upload', 'unggah', 'import'] },
    { file: 'BACK.png', keys: ['kembali', 'back'] },
    { file: 'SEE.svg', keys: ['lihat', 'view', 'preview', 'monitoring'] },
    { file: 'MAKE.png', keys: ['proses', 'buat wo', 'generate', 'konfirmasi'] }
  ];
  const destructive = /(^|\b)(hapus|delete|remove)(\b|$)/i;
  const cancelOrClose = /(^|\b)(batal|cancel|cancle|tutup|close|kembali)(\b|$)|[×✕✖❌]/i;
  const leadingSymbols = /^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}✔✓✎✏🖨＋➕－✖×❌🔍👁📄🕘💾⬇⬆➡⬅]+/u;
  function getLabel(el) {
    return (el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim();
  }
  function iconFor(label) {
    const s = label.toLowerCase();
    if (destructive.test(s)) return 'DELETE.png';
    if (cancelOrClose.test(s)) return 'CANCLE MAKE.png';
    if (/(^|\b)(keluar|logout|log out)(\b|$)/i.test(s)) return 'LOGOUT.png';
    for (const item of icons) {
      if (item.keys.some(k => s.includes(k))) return item.file;
    }
    return '';
  }
  function enhance(el) {
    if (!el || el.dataset.symbolEnhanced === '1') return;
    // Tombol Keluar di sidebar sudah memiliki ikon LOGOUT.png sendiri; jangan menggandakan ikon.
    if (el.closest('.sidebar') && el.classList.contains('logout-button')) return;
    const label = getLabel(el);
    const file = iconFor(label);
    if (!file) return;
    el.dataset.symbolEnhanced = '1';
    el.classList.add('mw-symbol-button');
    if (destructive.test(label) || cancelOrClose.test(label)) el.classList.add('mw-button-danger');
    else el.classList.add('mw-button-primary');
    // Remove a leading decorative character while preserving label text and child controls.
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest('.mw-button-symbol')) continue;
      const original = node.nodeValue || '';
      const cleaned = original.replace(leadingSymbols, '');
      if (cleaned !== original) { node.nodeValue = cleaned; break; }
      if (original.trim()) break;
    }
    const img = document.createElement('img');
    img.className = 'mw-button-symbol';
    img.src = base + file;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    el.insertBefore(img, el.firstChild);
  }
  function scan(root) {
    if (!root) return;
    if (root.matches && root.matches('button, a.btn, a.button, .btn, [role="button"], input[type="button"], input[type="submit"]')) enhance(root);
    if (root.querySelectorAll) root.querySelectorAll('button, a.btn, a.button, .btn, [role="button"], input[type="button"], input[type="submit"]').forEach(enhance);
  }
  function fixModalCloseSymbols(root) {
    if (!root || !root.querySelectorAll) return;
    const selectors = '.modal button, .modal [role="button"], .modal .close, .modal .modal-close, .modal .close-modal, [data-dismiss="modal"], [data-bs-dismiss="modal"]';
    root.querySelectorAll(selectors).forEach(el => {
      const label = getLabel(el);
      const isClose = el.matches('[data-dismiss="modal"], [data-bs-dismiss="modal"], .close, .modal-close, .close-modal, [aria-label*="close" i], [title*="close" i]') || /^[×✕✖❌x]$/i.test(label);
      if (!isClose) return;
      el.querySelectorAll('.mw-button-symbol, img.mw-modal-close-symbol').forEach(img => img.remove());
      // Hapus ikon lama yang menandai hapus; close modal memakai aset CANCLE MAKE.png.
      el.querySelectorAll('img').forEach(img => { if (/DELETE\.png/i.test(img.getAttribute('src') || '')) img.remove(); });
      const img = document.createElement('img');
      img.className = 'mw-button-symbol mw-modal-close-symbol';
      img.src = base + 'CANCLE MAKE.png'; img.alt = ''; img.setAttribute('aria-hidden', 'true');
      el.insertBefore(img, el.firstChild);
      el.classList.add('mw-cancel-button');
    });
  }
  function init() {
    scan(document);
    fixModalCloseSymbols(document);
    const observer = new MutationObserver(records => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach(n => { if (n.nodeType === 1) { scan(n); fixModalCloseSymbols(n); } });
        else if (r.type === 'characterData') {
          const p = r.target.parentElement && r.target.parentElement.closest('button, a.btn, a.button, .btn, [role="button"]');
          if (p) { p.dataset.symbolEnhanced = ''; p.querySelectorAll('.mw-button-symbol').forEach(i => i.remove()); p.classList.remove('mw-symbol-button','mw-button-primary','mw-button-danger'); scan(p); }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();