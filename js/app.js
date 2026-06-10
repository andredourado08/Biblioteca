const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};

const app = {
  supabase: null,
  session: null,
  user: null,
  library: null,
  books: [],
  progressByBook: new Map(),
  annotations: [],
  booksChannel: null,
  annotationsChannel: null,
  currentBook: null,
  selectedColor: '#f8e16c',
  pdfDoc: null,
  pdfPage: 1,
  pdfTotal: 0,
  zoom: 1.2,
  epubBook: null,
  epubRendition: null,
  search: '',
  categoryFilter: 'all',
  highlightMode: false,
};

const els = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindUi();
  applyStoredTheme();

  if (!isConfigured()) {
    showSetup();
    return;
  }

  await waitForLibraries();
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  app.supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.localStorage,
    },
  });

  const { data } = await app.supabase.auth.getSession();
  app.session = data.session;
  app.user = data.session?.user ?? null;

  app.supabase.auth.onAuthStateChange(async (_event, session) => {
    app.session = session;
    app.user = session?.user ?? null;
    await renderForAuthState();
  });

  await renderForAuthState();
}

function cacheElements() {
  for (const id of [
    'toast', 'setupPanel', 'authView', 'appView', 'authForm', 'authEmail', 'authPassword', 'signUpBtn',
    'signOutBtn', 'themeToggleBtn', 'libraryName', 'memberEmail', 'bookCount', 'recentCount',
    'searchInput', 'catalogFilter', 'openUploadBtn', 'uploadDialog', 'closeUploadBtn', 'bookForm',
    'bookTitle', 'bookCategories', 'bookCategoryOptions', 'bookFile', 'coverFile', 'bookFileName', 'coverFileName', 'uploadStatus',
    'booksGrid', 'emptyState', 'syncStatus', 'inviteForm', 'inviteEmail', 'readerOverlay',
    'closeReaderBtn', 'readerTitle', 'readerProgress', 'readerViewport', 'pageIndicator',
    'prevPageBtn', 'nextPageBtn', 'zoomInBtn', 'zoomOutBtn', 'toggleHighlightModeBtn', 'toggleAnnotationsBtn', 'closeAnnotationsBtn', 'annotationBackdrop', 'manualAnnotationBtn', 'annotationsList', 'colorPicker'
  ]) {
    els[id] = document.getElementById(id);
  }
}

function bindUi() {
  els.authForm.addEventListener('submit', signIn);
  els.signUpBtn.addEventListener('click', signUp);
  els.signOutBtn.addEventListener('click', signOut);
  els.themeToggleBtn.addEventListener('click', toggleTheme);
  els.openUploadBtn.addEventListener('click', () => els.uploadDialog.classList.remove('hidden'));
  els.closeUploadBtn.addEventListener('click', closeUploadDialog);
  els.uploadDialog.addEventListener('click', (event) => {
    if (event.target === els.uploadDialog) closeUploadDialog();
  });
  els.bookForm.addEventListener('submit', createBook);
  els.bookFile.addEventListener('change', () => updateFilePickerLabel(els.bookFile, els.bookFileName, 'PDF ou EPUB'));
  els.coverFile.addEventListener('change', () => updateFilePickerLabel(els.coverFile, els.coverFileName, 'Opcional'));
  els.searchInput.addEventListener('input', () => {
    app.search = els.searchInput.value.trim().toLowerCase();
    renderBooks();
  });
  els.catalogFilter.addEventListener('click', handleCatalogFilter);
  els.bookCategoryOptions.addEventListener('click', toggleBookCategory);
  els.inviteForm.addEventListener('submit', inviteMember);
  els.closeReaderBtn.addEventListener('click', closeReader);
  els.prevPageBtn.addEventListener('click', previousPage);
  els.nextPageBtn.addEventListener('click', nextPage);
  els.zoomInBtn.addEventListener('click', () => changeZoom(0.15));
  els.zoomOutBtn.addEventListener('click', () => changeZoom(-0.15));
  els.toggleHighlightModeBtn?.addEventListener('click', toggleHighlightMode);
  els.toggleAnnotationsBtn?.addEventListener('click', toggleAnnotationsPanel);
  els.closeAnnotationsBtn?.addEventListener('click', closeAnnotationsPanel);
  els.annotationBackdrop?.addEventListener('click', closeAnnotationsPanel);
  els.manualAnnotationBtn?.addEventListener('click', createManualAnnotation);
  els.colorPicker.addEventListener('click', (event) => {
    const button = event.target.closest('[data-color]');
    if (!button) return;
    app.selectedColor = button.dataset.color;
    els.colorPicker.querySelectorAll('.color-dot').forEach((dot) => dot.classList.remove('active'));
    button.classList.add('active');
  });
}

function handleCatalogFilter(event) {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  app.categoryFilter = button.dataset.category || 'all';
  els.catalogFilter.querySelectorAll('.catalog-chip').forEach((chip) => {
    chip.classList.toggle('active', chip === button);
  });
  renderBooks();
}

function toggleBookCategory(event) {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  button.classList.toggle('active');
  syncSelectedCategories();
}

function getSelectedBookCategories() {
  return Array.from(els.bookCategoryOptions.querySelectorAll('.category-option.active'))
    .map((button) => button.dataset.category)
    .filter(Boolean);
}

function syncSelectedCategories() {
  els.bookCategories.value = getSelectedBookCategories().join(',');
}

function resetBookCategoryOptions() {
  els.bookCategoryOptions.querySelectorAll('.category-option.active').forEach((button) => {
    button.classList.remove('active');
  });
  els.bookCategories.value = '';
}
function isConfigured() {
  return SUPABASE_CONFIG.url.startsWith('https://') && !SUPABASE_CONFIG.anonKey.includes('COLE_AQUI');
}

function showSetup() {
  els.setupPanel.classList.remove('hidden');
  els.authView.classList.add('hidden');
  els.appView.classList.add('hidden');
}

async function waitForLibraries() {
  for (let i = 0; i < 50; i += 1) {
    if (window.supabase && window.pdfjsLib && window.ePub) return;
    await sleep(100);
  }
  throw new Error('Bibliotecas externas não carregaram. Verifique a conexão com a internet.');
}


function getRememberedLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem('remembered-library') || '{}');
    const code = normalizeLibraryCode(saved.code || localStorage.getItem('library-share-code'));
    const name = String(saved.name || localStorage.getItem('reader-name') || '').trim();
    return { code, name };
  } catch {
    return {
      code: normalizeLibraryCode(localStorage.getItem('library-share-code')),
      name: String(localStorage.getItem('reader-name') || '').trim(),
    };
  }
}

function rememberLibrary(name, code) {
  const remembered = {
    name: String(name || 'Leitor').trim() || 'Leitor',
    code: normalizeLibraryCode(code),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem('remembered-library', JSON.stringify(remembered));
  localStorage.setItem('reader-name', remembered.name);
  localStorage.setItem('library-share-code', remembered.code);
}

function forgetRememberedLibrary() {
  localStorage.removeItem('remembered-library');
  localStorage.removeItem('library-share-code');
  localStorage.removeItem('reader-name');
}

function prefillEntryForm() {
  const remembered = getRememberedLibrary();
  if (els.authEmail && remembered.name) els.authEmail.value = remembered.name;
  if (els.authPassword && remembered.code) els.authPassword.value = remembered.code;
}
async function renderForAuthState() {
  els.setupPanel.classList.add('hidden');
  const remembered = getRememberedLibrary();
  const savedCode = remembered.code;
  const savedName = remembered.name;

  if (!savedCode) {
    showEntry();
    return;
  }

  try {
    await ensureAnonymousSession(savedName || 'Leitor');
    const library = await joinLibraryByCode(savedCode, savedName || 'Leitor');
    await activateLibrary(library, savedName || 'Leitor', savedCode);
  } catch (error) {
    showEntry();
    showToast(error.message || 'Não consegui abrir agora, mas mantive sua biblioteca salva.', true);
  }
}

function showEntry() {
  els.authView.classList.remove('hidden');
  els.appView.classList.add('hidden');
  prefillEntryForm();
  cleanupChannels();
}

async function signIn(event) {
  event.preventDefault();
  const displayName = els.authEmail.value.trim();
  const code = normalizeLibraryCode(els.authPassword.value);
  if (!displayName) return showToast('Digite seu nome.', true);
  if (!code) return showToast('Cole o código da biblioteca.', true);

  try {
    await ensureAnonymousSession(displayName);
    const library = await joinLibraryByCode(code, displayName);
    await activateLibrary(library, displayName, code);
    showToast('Você entrou na biblioteca compartilhada.');
  } catch (error) {
    showToast(error.message || 'Não consegui entrar com esse código.', true);
  }
}

async function signUp() {
  const displayName = els.authEmail.value.trim();
  if (!displayName) return showToast('Digite seu nome antes de criar a biblioteca.', true);

  try {
    await ensureAnonymousSession(displayName);
    const { data, error } = await app.supabase.rpc('create_library_quick', {
      p_name: 'Biblioteca Princesa',
      p_display_name: displayName,
    });
    if (error) throw error;
    const library = Array.isArray(data) ? data[0] : data;
    await activateLibrary(library, displayName, library.share_code);
    showToast('Biblioteca criada. Compartilhe o código com ela.');
  } catch (error) {
    showToast(error.message || 'Não consegui criar a biblioteca.', true);
  }
}

async function signOut() {
  cleanupChannels();
  forgetRememberedLibrary();
  await app.supabase.auth.signOut();
  showEntry();
}

async function ensureAnonymousSession(displayName) {
  if (app.user) return;
  const { data, error } = await app.supabase.auth.signInAnonymously();
  if (error) {
    throw new Error('Ative Anonymous sign-ins no Supabase e execute o arquivo supabase/modo-pratico.sql no SQL Editor.');
  }
  app.session = data.session;
  app.user = data.user;
}

async function joinLibraryByCode(code, displayName) {
  const { data, error } = await app.supabase.rpc('join_library_by_code', {
    p_share_code: normalizeLibraryCode(code),
    p_display_name: displayName,
  });
  if (error) throw error;
  const library = Array.isArray(data) ? data[0] : data;
  if (!library?.id) throw new Error('Código de biblioteca não encontrado.');
  return library;
}

async function activateLibrary(library, displayName, code) {
  app.library = library;
  rememberLibrary(displayName, code || library.share_code);
  els.authView.classList.add('hidden');
  els.appView.classList.remove('hidden');
  els.libraryName.textContent = 'Biblioteca Princesa';
  els.memberEmail.textContent = displayName;
  els.inviteEmail.value = normalizeLibraryCode(library.share_code);
  await loadBooks();
  subscribeToBooks();
}

async function loadBooks() {
  setSyncStatus('Atualizando...');
  const { data: books, error } = await app.supabase
    .from('books')
    .select('*')
    .eq('library_id', app.library.id)
    .order('created_at', { ascending: false });

  if (error) return throwFriendly(error);
  app.books = books ?? [];
  await loadProgress();
  renderBooks();
  setSyncStatus('Sincronizado');
}

async function loadProgress() {
  if (!app.books.length) {
    app.progressByBook.clear();
    return;
  }
  const ids = app.books.map((book) => book.id);
  const { data, error } = await app.supabase
    .from('reading_progress')
    .select('*')
    .eq('user_id', app.user.id)
    .in('book_id', ids);

  if (error) return throwFriendly(error);
  app.progressByBook = new Map((data ?? []).map((row) => [row.book_id, row]));
}

function subscribeToBooks() {
  if (app.booksChannel) app.supabase.removeChannel(app.booksChannel);
  app.booksChannel = app.supabase
    .channel(`books:${app.library.id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'books',
      filter: `library_id=eq.${app.library.id}`,
    }, loadBooks)
    .subscribe();
}

function renderBooks() {
  const filtered = app.books.filter((book) => {
    const haystack = [book.title, book.file_type, ...(book.categories ?? [])].join(' ').toLowerCase();
    const matchesSearch = !app.search || haystack.includes(app.search);
    const categories = (book.categories ?? []).map((category) => String(category).toLowerCase());
    const matchesCategory = app.categoryFilter === 'all' || categories.includes(app.categoryFilter.toLowerCase());
    return matchesSearch && matchesCategory;
  });

  els.bookCount.textContent = app.books.length;
  els.recentCount.textContent = app.books.filter((book) => daysSince(book.created_at) <= 14).length;
  els.emptyState.classList.toggle('hidden', filtered.length > 0);

  els.booksGrid.innerHTML = filtered.map((book) => {
    const progress = app.progressByBook.get(book.id);
    const percent = Math.round(progress?.progress_percent ?? 0);
    const cover = book.cover_path
      ? `<img src="" data-cover-path="${escapeHtml(book.cover_path)}" alt="">`
      : `<i class="fa-solid fa-book-open"></i>`;
    const tags = (book.categories ?? []).slice(0, 3).map((cat) => `<span class="tag">${escapeHtml(cat)}</span>`).join('');

    return `
      <article class="book-card" data-book-id="${book.id}">
        <div class="book-cover">${cover}</div>
        <h3>${escapeHtml(book.title)}</h3>
        <div class="book-meta">${book.file_type.toUpperCase()}</div>
        <div class="book-tags">${tags}</div>
        <div class="book-progress">${percent}% lido</div>
        <div class="card-actions">
          <button class="primary-btn" data-action="read">Ler</button>
          <button class="icon-btn" data-action="download" title="Baixar"><i class="fa-solid fa-download"></i></button>
          <button class="icon-btn" data-action="delete" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>
    `;
  }).join('');

  els.booksGrid.querySelectorAll('.book-card').forEach((card) => {
    const book = app.books.find((item) => item.id === card.dataset.bookId);
    card.addEventListener('click', (event) => handleBookAction(event, book));
  });

  loadCoverUrls();
}

async function loadCoverUrls() {
  const images = Array.from(els.booksGrid.querySelectorAll('[data-cover-path]'));
  await Promise.all(images.map(async (image) => {
    const url = await signedUrl('book-covers', image.dataset.coverPath, 3600);
    if (url) image.src = url;
  }));
}

async function handleBookAction(event, book) {
  const button = event.target.closest('[data-action]');
  if (!book) return;
  if (!button) return openReader(book);
  const action = button.dataset.action;
  if (action === 'read') await openReader(book);
  if (action === 'download') await downloadBook(book);
  if (action === 'delete') await deleteBook(book);
}

async function createBook(event) {
  event.preventDefault();
  const file = els.bookFile.files[0];
  if (!file) return showToast('Selecione um PDF ou EPUB.', true);

  const extension = file.name.split('.').pop()?.toLowerCase();
  const fileType = extension === 'epub' ? 'epub' : 'pdf';
  if (!['pdf', 'epub'].includes(fileType)) return showToast('Use arquivos PDF ou EPUB.', true);

  const bookId = crypto.randomUUID();
  const filePath = `${app.library.id}/${bookId}/book.${fileType}`;
  const cover = els.coverFile.files[0];
  const coverPath = cover ? `${app.library.id}/${bookId}/cover-${sanitizeFileName(cover.name)}` : null;
  const categories = els.bookCategories.value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  try {
    setUploadStatus('Enviando arquivo do livro...');
    await uploadFile('book-files', filePath, file);

    if (cover && coverPath) {
      setUploadStatus('Enviando capa...');
      await uploadFile('book-covers', coverPath, cover);
    }

    setUploadStatus('Salvando metadados...');
    const { error } = await app.supabase.from('books').insert({
      id: bookId,
      library_id: app.library.id,
      uploaded_by: app.user.id,
      title: els.bookTitle.value.trim(),
      categories,
      file_type: fileType,
      file_path: filePath,
      cover_path: coverPath,
      file_size: file.size,
    });

    if (error) throw error;
    showToast('Livro adicionado e sincronizado.');
    closeUploadDialog();
    await loadBooks();
  } catch (error) {
    showToast(error.message, true);
    setUploadStatus('');
  }
}

async function uploadFile(bucket, path, file) {
  const { error } = await app.supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
}

async function deleteBook(book) {
  const confirmed = await askConfirm({
    title: 'Excluir livro?',
    message: `Você quer mesmo remover "${book.title}" da biblioteca compartilhada?`,
    confirmText: 'Excluir',
    cancelText: 'Manter',
    danger: true,
  });
  if (!confirmed) return;
  const files = [book.file_path].filter(Boolean);
  const covers = [book.cover_path].filter(Boolean);
  if (files.length) await app.supabase.storage.from('book-files').remove(files);
  if (covers.length) await app.supabase.storage.from('book-covers').remove(covers);
  const { error } = await app.supabase.from('books').delete().eq('id', book.id);
  if (error) return showToast(error.message, true);
  showToast('Livro removido.');
  await loadBooks();
}

async function downloadBook(book) {
  const url = await signedUrl('book-files', book.file_path, 300);
  if (!url) return;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${book.title}.${book.file_type}`;
  anchor.click();
}

async function inviteMember(event) {
  event.preventDefault();
  const code = normalizeLibraryCode(app.library?.share_code || localStorage.getItem('library-share-code'));
  if (!code) return showToast('Nenhum código de biblioteca disponível.', true);
  try {
    await navigator.clipboard.writeText(code);
    showToast('Código copiado.');
  } catch {
    els.inviteEmail.select();
    document.execCommand('copy');
    showToast('Código selecionado para copiar.');
  }
}

async function openReader(book) {
  app.currentBook = book;
  app.annotations = [];
  app.highlightMode = false;
  updateHighlightModeUi();
  els.readerTitle.textContent = book.title;
  closeAnnotationsPanel();
  els.readerOverlay.classList.remove('hidden');
  els.readerViewport.innerHTML = '';
  await loadAnnotations(book.id);
  subscribeToAnnotations(book.id);

  const url = await signedUrl('book-files', book.file_path, 3600);
  if (!url) return closeReader();

  if (book.file_type === 'epub') {
    await openEpub(url, book);
  } else {
    await openPdf(url, book);
  }
}

async function openPdf(url, book) {
  disposeEpub();
  const data = await fetch(url).then((response) => response.arrayBuffer());
  app.pdfDoc = await window.pdfjsLib.getDocument({ data }).promise;
  app.pdfTotal = app.pdfDoc.numPages;
  const progress = app.progressByBook.get(book.id);
  app.pdfPage = clamp(Number(progress?.location?.page ?? 1), 1, app.pdfTotal);
  const firstPage = await app.pdfDoc.getPage(app.pdfPage);
  app.zoom = getResponsivePdfZoom(firstPage);
  await renderPdfPage();
}

function getResponsivePdfZoom(page) {
  const baseViewport = page.getViewport({ scale: 1 });
  const viewportWidth = els.readerViewport?.clientWidth || window.innerWidth;
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  const horizontalPadding = mobile ? 20 : 56;
  const availableWidth = Math.max(260, viewportWidth - horizontalPadding);
  const fitZoom = availableWidth / baseViewport.width;
  return clamp(Number(Math.min(1.2, fitZoom).toFixed(2)), 0.4, 1.2);
}
async function renderPdfPage() {
  const page = await app.pdfDoc.getPage(app.pdfPage);
  const viewport = page.getViewport({ scale: app.zoom });

  els.readerViewport.innerHTML = `
    <div class="pdf-page" id="pdfPageWrap" style="width:${viewport.width}px;height:${viewport.height}px">
      <canvas id="pdfCanvas"></canvas>
      <div id="textLayer" class="textLayer"></div>
      <div id="highlightLayer" class="highlightLayer"></div>
    </div>
  `;

  const canvas = document.getElementById('pdfCanvas');
  const context = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  await page.render({ canvasContext: context, viewport }).promise;
  await renderPdfTextLayer(page, viewport);
  drawPdfHighlights();
  updatePdfToolbar();
  saveProgress({
    location: { page: app.pdfPage, totalPages: app.pdfTotal },
    progress_percent: (app.pdfPage / app.pdfTotal) * 100,
  });

  document.getElementById('pdfPageWrap').addEventListener('mouseup', handlePdfSelection);
  document.getElementById('pdfPageWrap').addEventListener('touchend', () => setTimeout(handlePdfSelection, 120));
}

async function renderPdfTextLayer(page, viewport) {
  const textLayer = document.getElementById('textLayer');
  const textContent = await page.getTextContent();
  try {
    await window.pdfjsLib.renderTextLayer({
      textContentSource: textContent,
      container: textLayer,
      viewport,
      textDivs: [],
    }).promise;
  } catch {
    await window.pdfjsLib.renderTextLayer({
      textContent,
      container: textLayer,
      viewport,
      textDivs: [],
    }).promise;
  }
}

async function handlePdfSelection() {
  if (!app.highlightMode) return;
  const selection = window.getSelection();
  if (selection.rangeCount === 0 || !app.currentBook) return;
  const pageWrap = document.getElementById('pdfPageWrap');
  if (!pageWrap) return;

  const range = selection.getRangeAt(0);
  const selectedText = getBestPdfSelectionText(selection, range, pageWrap);
  if (!selectedText) return;

  const pageRect = pageWrap.getBoundingClientRect();
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 2 && rect.height > 2)
    .map((rect) => ({
      x: (rect.left - pageRect.left) / pageRect.width,
      y: (rect.top - pageRect.top) / pageRect.height,
      w: rect.width / pageRect.width,
      h: rect.height / pageRect.height,
    }))
    .filter((rect) => rect.x >= 0 && rect.y >= 0 && rect.x <= 1 && rect.y <= 1);

  if (!rects.length) return;

  const decision = await askAnnotationIntent(selectedText);
  selection.removeAllRanges();
  if (!decision) return;

  const { error } = await app.supabase.from('annotations').insert({
    book_id: app.currentBook.id,
    user_id: app.user.id,
    format: 'pdf',
    page_number: app.pdfPage,
    selected_text: selectedText,
    note: decision.note,
    color: decision.color,
    selector: { rects },
  });

  if (error) return showToast(error.message, true);
  showToast(decision.note ? 'Grifo e anotação salvos.' : 'Trecho grifado.');
  await loadAnnotations(app.currentBook.id);
}

function getBestPdfSelectionText(selection, range, pageWrap) {
  const rawText = cleanPdfSelectionText(selection.toString());
  const reconstructedText = reconstructPdfSelectionText(range, pageWrap);

  if (!reconstructedText) return rawText;
  if (!rawText) return reconstructedText;

  const rawScore = scorePdfSelectionText(rawText);
  const reconstructedScore = scorePdfSelectionText(reconstructedText);
  return reconstructedScore > rawScore ? reconstructedText : rawText;
}

function reconstructPdfSelectionText(range, pageWrap) {
  const textLayer = pageWrap.querySelector('.textLayer');
  if (!textLayer) return '';

  const selectionRects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 2 && rect.height > 2);
  if (!selectionRects.length) return '';

  const spans = Array.from(textLayer.querySelectorAll('span'))
    .map((span) => {
      const rect = span.getBoundingClientRect();
      const text = cleanPdfSelectionText(span.textContent);
      const selected = selectionRects.some((selectionRect) => rectsOverlap(selectionRect, rect, 1.5));
      return selected && text ? { text, x: rect.left, y: rect.top, height: rect.height } : null;
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(a.y - b.y) > Math.max(a.height, b.height) * 0.55 ? a.y - b.y : a.x - b.x);

  if (!spans.length) return '';

  const lines = [];
  for (const span of spans) {
    const lastLine = lines[lines.length - 1];
    if (!lastLine || Math.abs(lastLine.y - span.y) > Math.max(lastLine.height, span.height) * 0.65) {
      lines.push({ y: span.y, height: span.height, parts: [span.text] });
    } else {
      lastLine.parts.push(span.text);
      lastLine.height = Math.max(lastLine.height, span.height);
    }
  }

  return cleanPdfSelectionText(lines.map((line) => joinPdfTextParts(line.parts)).join(' '));
}

function joinPdfTextParts(parts) {
  return parts.reduce((text, part) => {
    if (!text) return part;
    if (/^[,.;:!?%)\]}]/.test(part)) return `${text}${part}`;
    if (/[([{]$/.test(text)) return `${text}${part}`;
    if (/^[a-záàâãéêíóôõúç]$/i.test(part) && /[a-záàâãéêíóôõúç]$/i.test(text)) return `${text}${part}`;
    return `${text} ${part}`;
  }, '');
}

function cleanPdfSelectionText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?%])/g, '$1')
    .trim();
}

function scorePdfSelectionText(value) {
  const text = cleanPdfSelectionText(value);
  const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  const separatedSingles = (text.match(/\b[\p{L}]\b/gu) || []).length;
  return letters * 2 - separatedSingles * 1.5 + Math.min(text.length, 80) / 40;
}

function rectsOverlap(a, b, tolerance = 0) {
  return !(
    a.right < b.left - tolerance ||
    a.left > b.right + tolerance ||
    a.bottom < b.top - tolerance ||
    a.top > b.bottom + tolerance
  );
}
function drawPdfHighlights() {
  const layer = document.getElementById('highlightLayer');
  const pageWrap = document.getElementById('pdfPageWrap');
  if (!layer || !pageWrap) return;

  const width = pageWrap.clientWidth;
  const height = pageWrap.clientHeight;
  const pageAnnotations = app.annotations.filter((item) => item.format === 'pdf' && item.page_number === app.pdfPage);
  layer.innerHTML = pageAnnotations.flatMap((annotation) => {
    return (annotation.selector?.rects ?? []).map((rect) => `
      <span class="pdf-highlight" style="
        --highlight-color:${annotation.color};
        left:${rect.x * width}px;
        top:${rect.y * height}px;
        width:${rect.w * width}px;
        height:${rect.h * height}px;
      "></span>
    `);
  }).join('');
}

async function openEpub(url, book) {
  app.pdfDoc = null;
  app.pdfTotal = 0;
  disposeEpub();
  els.readerViewport.innerHTML = '<div id="epubHost" class="epub-host"></div>';
  app.epubBook = window.ePub(url);
  app.epubRendition = app.epubBook.renderTo('epubHost', {
    width: '100%',
    height: '100%',
    spread: 'none',
  });

  await app.epubBook.ready;
  await app.epubBook.locations.generate(1200);

  const progress = app.progressByBook.get(book.id);
  await app.epubRendition.display(progress?.location?.cfi || undefined);
  applyEpubTheme();
  applyEpubAnnotations();

  app.epubRendition.on('relocated', (location) => {
    const percent = app.epubBook.locations.percentageFromCfi(location.start.cfi) * 100;
    els.readerProgress.textContent = `${Math.round(percent)}%`;
    els.pageIndicator.textContent = 'EPUB';
    saveProgress({
      location: { cfi: location.start.cfi },
      progress_percent: percent,
    });
  });

  app.epubRendition.on('selected', async (cfiRange, contents) => {
    if (!app.highlightMode) {
      contents.window.getSelection().removeAllRanges();
      return;
    }
    const selectedText = contents.window.getSelection().toString().trim();
    contents.window.getSelection().removeAllRanges();
    if (!selectedText) return;
    const decision = await askAnnotationIntent(selectedText);
    if (!decision) return;
    const { error } = await app.supabase.from('annotations').insert({
      book_id: app.currentBook.id,
      user_id: app.user.id,
      format: 'epub',
      selected_text: selectedText,
      note: decision.note,
      color: decision.color,
      selector: { cfiRange },
    });
    if (error) return showToast(error.message, true);
    showToast(decision.note ? 'Grifo e anotação salvos.' : 'Trecho grifado.');
    await loadAnnotations(app.currentBook.id);
  });
}

function applyEpubTheme() {
  if (!app.epubRendition) return;
  const dark = document.body.classList.contains('dark');
  app.epubRendition.themes.default({
    body: {
      color: dark ? '#f1eee8' : '#241f1a',
      background: dark ? '#20242b' : '#fffdfa',
      'font-family': 'Georgia, serif',
      'line-height': '1.7',
    },
    '::selection': {
      background: app.selectedColor,
    },
  });
  app.epubRendition.themes.fontSize(`${Math.round(app.zoom * 100)}%`);
}

function applyEpubAnnotations() {
  if (!app.epubRendition) return;
  app.annotations
    .filter((annotation) => annotation.format === 'epub' && annotation.selector?.cfiRange)
    .forEach((annotation) => {
      app.epubRendition.annotations.highlight(
        annotation.selector.cfiRange,
        {},
        null,
        undefined,
        { fill: annotation.color, 'fill-opacity': '0.36', 'mix-blend-mode': 'multiply' }
      );
    });
}

async function loadAnnotations(bookId) {
  const { data, error } = await app.supabase
    .from('annotations')
    .select('*')
    .eq('book_id', bookId)
    .order('created_at', { ascending: false });

  if (error) return showToast(error.message, true);
  app.annotations = data ?? [];
  renderAnnotations();
  if (app.currentBook?.file_type === 'pdf') drawPdfHighlights();
  if (app.currentBook?.file_type === 'epub') applyEpubAnnotations();
}

function subscribeToAnnotations(bookId) {
  if (app.annotationsChannel) app.supabase.removeChannel(app.annotationsChannel);
  app.annotationsChannel = app.supabase
    .channel(`annotations:${bookId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'annotations',
      filter: `book_id=eq.${bookId}`,
    }, () => loadAnnotations(bookId))
    .subscribe();
}

function renderAnnotations() {
  if (!app.annotations.length) {
    els.annotationsList.innerHTML = '<p class="annotation-hint">As marcações aparecerão aqui.</p>';
    return;
  }

  els.annotationsList.innerHTML = app.annotations.map((annotation) => `
    <article class="annotation-card" style="--note-color:${annotation.color}">
      <p>${escapeHtml(annotation.selected_text)}</p>
      ${annotation.note ? `<small>${escapeHtml(annotation.note)}</small>` : ''}
      <small>${annotation.format.toUpperCase()}${annotation.page_number ? ` · Página ${annotation.page_number}` : ''}</small>
      <div class="annotation-actions">
        <button class="text-button annotation-edit" data-edit-annotation="${annotation.id}">Editar texto</button>
        <button class="text-button annotation-delete" data-delete-annotation="${annotation.id}">Excluir</button>
      </div>
    </article>
  `).join('');

  els.annotationsList.querySelectorAll('[data-edit-annotation]').forEach((button) => {
    button.addEventListener('click', async () => {
      const annotation = app.annotations.find((item) => item.id === button.dataset.editAnnotation);
      if (!annotation) return;
      const newText = await askAnnotationTextEdit(annotation.selected_text);
      if (!newText || newText === annotation.selected_text) return;
      const { error } = await app.supabase
        .from('annotations')
        .update({ selected_text: newText })
        .eq('id', annotation.id);
      if (error) return showToast(error.message, true);
      showToast('Texto da anotação atualizado.');
      await loadAnnotations(app.currentBook.id);
    });
  });
  els.annotationsList.querySelectorAll('[data-delete-annotation]').forEach((button) => {
    button.addEventListener('click', async () => {
      const { error } = await app.supabase.from('annotations').delete().eq('id', button.dataset.deleteAnnotation);
      if (error) return showToast(error.message, true);
      await loadAnnotations(app.currentBook.id);
    });
  });
}

async function createManualAnnotation() {
  if (!app.currentBook) return;
  const manual = await askManualAnnotation();
  if (!manual) return;
  const format = app.currentBook.file_type || 'manual';
  const { error } = await app.supabase.from('annotations').insert({
    book_id: app.currentBook.id,
    user_id: app.user.id,
    format,
    page_number: format === 'pdf' ? app.pdfPage : null,
    selected_text: manual.text,
    note: manual.note,
    color: app.selectedColor,
    selector: { manual: true },
  });
  if (error) return showToast(error.message, true);
  showToast('Anotação manual salva.');
  await loadAnnotations(app.currentBook.id);
  openAnnotationsPanel();
}

function askManualAnnotation() {
  return new Promise((resolve) => {
    const modal = createAppModal({
      title: 'Anotação manual',
      message: 'Use quando a seleção do PDF não pegar o trecho certinho.',
      body: `
        <label class="modal-field">
          Trecho ou título
          <textarea id="manualTextInput" rows="3" placeholder="Escreva o trecho ou uma frase curta"></textarea>
        </label>
        <label class="modal-field">
          Comentário opcional
          <textarea id="manualNoteInput" rows="3" placeholder="Escreva sua observação"></textarea>
        </label>
      `,
      actions: [
        { label: 'Cancelar', value: 'cancel', variant: 'ghost' },
        { label: 'Salvar anotação', value: 'save', variant: 'primary' },
      ],
    });
    modal.onAction = (value) => {
      const text = cleanPdfSelectionText(modal.root.querySelector('#manualTextInput')?.value || '');
      const note = cleanPdfSelectionText(modal.root.querySelector('#manualNoteInput')?.value || '');
      modal.close();
      resolve(value === 'save' && text ? { text, note } : null);
    };
  });
}
function askAnnotationTextEdit(currentText) {
  return new Promise((resolve) => {
    const modal = createAppModal({
      title: 'Corrigir texto do grifo',
      message: 'Ajuste o texto que aparece na lista de anotações.',
      body: `
        <label class="modal-field">
          Texto do grifo
          <textarea id="annotationTextEdit" rows="4">${escapeHtml(currentText)}</textarea>
        </label>
      `,
      actions: [
        { label: 'Cancelar', value: 'cancel', variant: 'ghost' },
        { label: 'Salvar texto', value: 'save', variant: 'primary' },
      ],
    });
    modal.onAction = (value) => {
      const textarea = modal.root.querySelector('#annotationTextEdit');
      const text = cleanPdfSelectionText(textarea?.value || '');
      modal.close();
      resolve(value === 'save' && text ? text : null);
    };
  });
}
async function saveProgress(payload) {
  if (!app.currentBook) return;
  const { error } = await app.supabase.from('reading_progress').upsert({
    book_id: app.currentBook.id,
    user_id: app.user.id,
    ...payload,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'book_id,user_id' });

  if (!error) {
    app.progressByBook.set(app.currentBook.id, {
      book_id: app.currentBook.id,
      user_id: app.user.id,
      ...payload,
    });
    renderBooks();
  }
}

function previousPage() {
  if (app.currentBook?.file_type === 'epub') return app.epubRendition?.prev();
  if (app.pdfDoc && app.pdfPage > 1) {
    app.pdfPage -= 1;
    renderPdfPage();
  }
}

function nextPage() {
  if (app.currentBook?.file_type === 'epub') return app.epubRendition?.next();
  if (app.pdfDoc && app.pdfPage < app.pdfTotal) {
    app.pdfPage += 1;
    renderPdfPage();
  }
}

function changeZoom(delta) {
  app.zoom = clamp(Number((app.zoom + delta).toFixed(2)), 0.4, 2.4);
  if (app.currentBook?.file_type === 'epub') {
    applyEpubTheme();
  } else if (app.pdfDoc) {
    renderPdfPage();
  }
}

function updatePdfToolbar() {
  const percent = Math.round((app.pdfPage / app.pdfTotal) * 100);
  els.readerProgress.textContent = `${percent}%`;
  els.pageIndicator.textContent = `${app.pdfPage}/${app.pdfTotal}`;
}

function toggleHighlightMode() {
  app.highlightMode = !app.highlightMode;
  updateHighlightModeUi();
  showToast(app.highlightMode ? 'Modo grifo ativado. Selecione um trecho.' : 'Modo leitura ativado.');
}

function updateHighlightModeUi() {
  els.readerOverlay?.classList.toggle('highlight-mode', Boolean(app.highlightMode));
  if (!els.toggleHighlightModeBtn) return;
  els.toggleHighlightModeBtn.setAttribute('aria-pressed', String(Boolean(app.highlightMode)));
  els.toggleHighlightModeBtn.innerHTML = app.highlightMode
    ? '<i class="fa-solid fa-pen-nib"></i> Grifo ligado'
    : '<i class="fa-solid fa-book-open"></i> Ler';
}
function toggleAnnotationsPanel() {
  els.readerOverlay.classList.toggle('annotations-open');
}

function openAnnotationsPanel() {
  els.readerOverlay?.classList.add('annotations-open');
}

function closeAnnotationsPanel() {
  els.readerOverlay?.classList.remove('annotations-open');
}
function closeReader() {
  closeAnnotationsPanel();
  els.readerOverlay.classList.add('hidden');
  els.readerViewport.innerHTML = '';
  app.currentBook = null;
  app.pdfDoc = null;
  disposeEpub();
  if (app.annotationsChannel) {
    app.supabase.removeChannel(app.annotationsChannel);
    app.annotationsChannel = null;
  }
}

function disposeEpub() {
  if (app.epubRendition) app.epubRendition.destroy();
  if (app.epubBook) app.epubBook.destroy();
  app.epubRendition = null;
  app.epubBook = null;
}

async function signedUrl(bucket, path, expiresIn) {
  const { data, error } = await app.supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) {
    showToast(error.message, true);
    return null;
  }
  return data.signedUrl;
}

function closeUploadDialog() {
  els.uploadDialog.classList.add('hidden');
  els.bookForm.reset();
  resetBookCategoryOptions();
  if (els.bookFileName) els.bookFileName.textContent = 'PDF ou EPUB';
  if (els.coverFileName) els.coverFileName.textContent = 'Opcional';
  setUploadStatus('');
}


function updateFilePickerLabel(input, label, fallback) {
  if (!label) return;
  label.textContent = input.files?.[0]?.name || fallback;
}
function setUploadStatus(text) {
  els.uploadStatus.textContent = text;
}

function setSyncStatus(text) {
  els.syncStatus.textContent = text;
}

function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem('library-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  applyEpubTheme();
}

function applyStoredTheme() {
  if (localStorage.getItem('library-theme') === 'dark') {
    document.body.classList.add('dark');
  }
}

function cleanupChannels() {
  if (app.booksChannel && app.supabase) app.supabase.removeChannel(app.booksChannel);
  if (app.annotationsChannel && app.supabase) app.supabase.removeChannel(app.annotationsChannel);
  app.booksChannel = null;
  app.annotationsChannel = null;
}


function askAnnotationIntent(selectedText) {
  return new Promise((resolve) => {
    const modal = createAppModal({
      title: 'Marcar este trecho?',
      message: 'Escolha o que você quer fazer com a seleção.',
      body: `
        <blockquote class="modal-selection">${escapeHtml(trimForPreview(selectedText, 260))}</blockquote>
        <label class="modal-field">
          Observação opcional
          <textarea id="modalNoteInput" rows="4" placeholder="Escreva uma observação sobre esse trecho"></textarea>
        </label>
      `,
      actions: [
        { label: 'Cancelar', value: null, variant: 'ghost' },
        { label: 'Só grifar', value: 'highlight', variant: 'secondary' },
        { label: 'Grifar e salvar nota', value: 'note', variant: 'primary' },
      ],
    });

    modal.onAction = (value) => {
      const note = modal.root.querySelector('#modalNoteInput')?.value.trim() || '';
      modal.close();
      if (!value) return resolve(null);
      resolve({ color: app.selectedColor, note: value === 'note' ? note : '' });
    };
  });
}

function askConfirm({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const modal = createAppModal({
      title,
      message,
      actions: [
        { label: cancelText, value: false, variant: 'ghost' },
        { label: confirmText, value: true, variant: danger ? 'danger' : 'primary' },
      ],
    });
    modal.onAction = (value) => {
      modal.close();
      resolve(Boolean(value));
    };
  });
}

function createAppModal({ title, message, body = '', actions = [] }) {
  const root = document.createElement('div');
  root.className = 'app-modal';
  root.innerHTML = `
    <div class="app-modal-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="app-modal-header">
        <div>
          <p class="eyebrow">Confirmação</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button class="icon-btn" type="button" data-modal-value="__close" title="Fechar"><i class="fa-solid fa-xmark"></i></button>
      </div>
      ${message ? `<p class="app-modal-message">${escapeHtml(message)}</p>` : ''}
      ${body ? `<div class="app-modal-body">${body}</div>` : ''}
      <div class="app-modal-actions">
        ${actions.map((action) => `<button type="button" class="modal-action modal-action-${action.variant}" data-modal-value="${String(action.value)}">${escapeHtml(action.label)}</button>`).join('')}
      </div>
    </div>
  `;

  const api = {
    root,
    onAction: null,
    close() {
      root.classList.add('closing');
      window.setTimeout(() => root.remove(), 160);
    },
  };

  root.addEventListener('click', (event) => {
    if (event.target === root) return api.onAction?.(null);
    const button = event.target.closest('[data-modal-value]');
    if (!button) return;
    const raw = button.dataset.modalValue;
    if (raw === '__close') return api.onAction?.(null);
    const action = actions.find((item) => String(item.value) === raw);
    api.onAction?.(action?.value ?? null);
  });

  document.body.appendChild(root);
  window.setTimeout(() => root.classList.add('ready'), 20);
  root.querySelector('textarea, button')?.focus();
  return api;
}

function trimForPreview(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
function throwFriendly(error) {
  showToast(error.message ?? String(error), true);
  throw error;
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.style.background = isError ? '#9b2727' : '#20242b';
  els.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove('show'), 3600);
}

function sanitizeFileName(name) {
  return name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/-+/g, '-');
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function daysSince(date) {
  return (Date.now() - new Date(date).getTime()) / 86_400_000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLibraryCode(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

