(() => {
  const settingsForm = document.getElementById('settingsForm');
  const previewForm = document.getElementById('previewForm');
  const previewFile = document.getElementById('previewFile');
  const previewButton = document.getElementById('previewButton');
  const previewStatus = document.getElementById('previewStatus');
  const previewDisplay = document.getElementById('previewDisplay');
  const batchForm = document.getElementById('batchForm');
  const batchFiles = document.getElementById('batchFiles');
  const batchStatus = document.getElementById('batchStatus');
  const includeTxt = document.getElementById('batchTxt');
  const includePng = document.getElementById('batchPng');
  const inputListEl = document.getElementById('inputList');
  const refreshInputBtn = document.getElementById('refreshInput');
  const convertUploadsBtn = document.getElementById('convertUploads');
  const uploadFolderBtn = document.getElementById('uploadFolder');
  const selectAllBtn = document.getElementById('selectAllInput');
  const clearSelectionBtn = document.getElementById('clearInputSelection');
  const previewSelectedBtn = document.getElementById('previewSelected');
  const convertInputBtn = document.getElementById('convertInput');
  const previewWidthInput = document.getElementById('previewWidth');
  const previewHeightInput = document.getElementById('previewHeight');
  const folderPicker = document.getElementById('folderPicker');

  if (!settingsForm || !previewForm || !batchForm) {
    console.warn('ASCII Generator web UI could not initialise: required elements are missing.');
    return;
  }

  let previewObjectUrl = null;
  let backendAvailable = true;
  let backendFailureReason = '';
  let lastLocalImage = null;
  let lastLocalImageName = '';
  const serverInputItems = [];
  const localInputFiles = new Map();
  const inputEntryStore = new Map();
  const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
  const colorNormalizationContext = (() => {
    const canvas = document.createElement('canvas');
    return canvas.getContext ? canvas.getContext('2d') : null;
  })();

  function expandShortHex(hex) {
    if (!hex || hex.length !== 4) {
      return (hex || '').toLowerCase();
    }
    const chars = hex.slice(1).split('').map((ch) => ch + ch).join('');
    return `#${chars.toLowerCase()}`;
  }

  function normalizeColorInput(value, fallback) {
    if (typeof value !== 'string') {
      return fallback;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
      return trimmed.length === 4 ? expandShortHex(trimmed) : trimmed.toLowerCase();
    }
    if (colorNormalizationContext) {
      try {
        colorNormalizationContext.fillStyle = '#000000';
        colorNormalizationContext.fillStyle = trimmed;
        const computed = colorNormalizationContext.fillStyle;
        if (/^#([0-9a-f]{6})$/i.test(computed)) {
          return computed.toLowerCase();
        }
      } catch (err) {
        // ignore - fall back to default
      }
    }
    return fallback;
  }

  function isSupportedImageFile(file) {
    if (!file) {
      return false;
    }
    const name = (file.name || '').toLowerCase();
    if (!name) {
      return false;
    }
    return IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext));
  }

  function getFileDisplayName(file) {
    if (!file) {
      return '';
    }
    const rel = typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath.trim() : '';
    if (rel) {
      return rel.replace(/^[/\\]+/, '');
    }
    return file.name || 'image';
  }

  function removeExtension(name) {
    if (typeof name !== 'string') {
      return '';
    }
    const idx = name.lastIndexOf('.');
    return idx > 0 ? name.slice(0, idx) : name;
  }

  function extractBaseName(name) {
    if (typeof name !== 'string') {
      return '';
    }
    const parts = name.split(/[/\\]/);
    const last = parts[parts.length - 1];
    return last || name;
  }

  function sanitizeFileComponent(value, fallback) {
    if (typeof value !== 'string') {
      return fallback;
    }
    const sanitized = value.replace(/[^a-z0-9]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return sanitized || fallback;
  }

  function supportsDirectoryPicker() {
    return typeof window.showDirectoryPicker === 'function';
  }

  async function ensureWritableDirectory(dirHandle) {
    if (!dirHandle) {
      throw new Error('A folder handle was not provided.');
    }
    const options = { mode: 'readwrite' };
    if (typeof dirHandle.queryPermission === 'function') {
      const state = await dirHandle.queryPermission(options);
      if (state === 'granted') {
        return;
      }
      if (state === 'denied') {
        throw new Error('Permission to write to the selected folder was denied.');
      }
    }
    if (typeof dirHandle.requestPermission === 'function') {
      const state = await dirHandle.requestPermission(options);
      if (state !== 'granted') {
        throw new Error('Permission to write to the selected folder was denied.');
      }
    }
  }

  async function writeFileToDirectory(dirHandle, filename, data) {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.truncate(0);
      await writable.write(data);
    } finally {
      await writable.close();
    }
  }

  async function saveConversionsToDirectory(conversions, options) {
    if (!supportsDirectoryPicker()) {
      throw new Error('Saving to a folder requires a compatible browser or including JSZip in the page.');
    }
    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker({ id: 'ascii-generator-output', mode: 'readwrite' });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error('Folder selection was canceled.');
      }
      const reason = err && err.message ? err.message : 'Failed to open the selected folder.';
      throw new Error(reason);
    }
    await ensureWritableDirectory(dirHandle);

    const { wantTxt, wantPng } = options;
    const writeErrors = [];

    for (const conversion of conversions) {
      if (wantTxt && conversion.ascii !== null) {
        try {
          await writeFileToDirectory(dirHandle, `${conversion.uniqueName}.txt`, conversion.ascii);
        } catch (err) {
          writeErrors.push(`${conversion.uniqueName}.txt: ${err && err.message ? err.message : String(err)}`);
        }
      }
      if (wantPng && conversion.pngBlob) {
        try {
          await writeFileToDirectory(dirHandle, `${conversion.uniqueName}.png`, conversion.pngBlob);
        } catch (err) {
          writeErrors.push(`${conversion.uniqueName}.png: ${err && err.message ? err.message : String(err)}`);
        }
      }
    }

    return writeErrors;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create PNG blob.'));
        }
      }, 'image/png');
    });
  }

  function setBatchButtonsDisabled(disabled) {
    if (!batchForm) {
      return;
    }
    const buttons = batchForm.querySelectorAll('button');
    buttons.forEach((btn) => {
      if (btn === convertUploadsBtn) {
        btn.disabled = disabled || !backendAvailable;
        if (!backendAvailable) {
          btn.title = backendFailureReason || 'Backend API unavailable.';
        } else if (!disabled) {
          btn.title = '';
        }
      } else if (btn === convertInputBtn) {
        btn.disabled = disabled;
      } else {
        btn.disabled = disabled;
      }
    });
  }

  async function extractErrorMessage(response) {
    const fallback = `${response.status} ${response.statusText}`;
    let text;
    try {
      text = await response.text();
    } catch (err) {
      return fallback;
    }
    if (!text) {
      return fallback;
    }
    try {
      const data = JSON.parse(text);
      if (data && typeof data.error === 'string' && data.error) {
        return data.error;
      }
    } catch (err) {
      // ignore JSON parse failure
    }
    return text;
  }

  function markBackendUnavailable(reason) {
    if (!backendAvailable) {
      return;
    }
    backendAvailable = false;
    backendFailureReason = reason || 'Backend API is unavailable on this host.';
    if (refreshInputBtn) {
      refreshInputBtn.disabled = true;
      refreshInputBtn.title = backendFailureReason;
    }
    if (convertInputBtn) {
      convertInputBtn.disabled = false;
      convertInputBtn.title = 'Convert locally uploaded images (server unavailable).';
    }
    if (convertUploadsBtn) {
      convertUploadsBtn.disabled = true;
      convertUploadsBtn.title = backendFailureReason;
    }
    [selectAllBtn, clearSelectionBtn, previewSelectedBtn].forEach((btn) => {
      if (btn) {
        btn.title = backendFailureReason;
      }
    });
    setBatchButtonsDisabled(false);
    serverInputItems.length = 0;
    updateInputList('Server-side features are unavailable on this site. Upload a folder to add images.');
    if (batchStatus && !batchStatus.textContent) {
      setStatus(batchStatus, backendFailureReason, 'error');
    }
  }

  function safeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function gatherNumericSettings() {
    const asciiChars = settingsForm.ascii_chars.value || '@%#*+=-:. ';
    return {
      output_width: safeNumber(settingsForm.output_width.value, 120),
      font_size: safeNumber(settingsForm.font_size.value, 12),
      black_threshold: safeNumber(settingsForm.black_threshold.value, 15),
      char_aspect: safeNumber(settingsForm.char_aspect.value, 0.55),
      fg_color: normalizeColorInput(settingsForm.fg_color.value, '#ffffff'),
      bg_color: normalizeColorInput(settingsForm.bg_color.value, '#000000'),
      ascii_chars: asciiChars,
      invert: settingsForm.invert.checked,
    };
  }

  function parseDimension(input, fallback) {
    if (!input) {
      return fallback;
    }
    const raw = typeof input.value === 'string' ? input.value.trim() : '';
    if (!raw) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return fallback;
    }
    return Math.min(value, 8192);
  }

  function applyPreviewDimensions() {
    const width = parseDimension(previewWidthInput, 640);
    const height = parseDimension(previewHeightInput, 360);
    if (previewDisplay) {
      previewDisplay.style.width = `${width}px`;
      previewDisplay.style.height = `${height}px`;
    }
  }

  async function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read the selected image.'));
      };
      img.src = url;
    });
  }

  async function renderPreviewLocally(file) {
    if (typeof window.toAscii !== 'function' || typeof window.asciiToCanvas !== 'function') {
      throw new Error('Local preview support is unavailable in this build.');
    }
    if (file) {
      lastLocalImage = await loadImageFromFile(file);
      lastLocalImageName = getFileDisplayName(file) || 'image';
    } else if (!lastLocalImage) {
      throw new Error('Upload an image to generate a preview.');
    }

    const settings = gatherNumericSettings();
    const ascii = await window.toAscii(lastLocalImage, settings);
    const canvas = window.asciiToCanvas(ascii, settings);
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    previewDisplay.innerHTML = '';
    previewDisplay.appendChild(canvas);
  }

  function addLocalFolderFiles(files) {
    if (!files || !files.length) {
      return;
    }
    let added = 0;
    Array.from(files).forEach((file) => {
      if (!isSupportedImageFile(file)) {
        return;
      }
      const key = (file.webkitRelativePath && file.webkitRelativePath.trim()) || file.name;
      if (!key) {
        return;
      }
      const normalizedKey = key.replace(/\\/g, '/');
      localInputFiles.set(normalizedKey, {
        file,
        displayName: getFileDisplayName(file) || normalizedKey,
      });
      added += 1;
    });
    if (added) {
      updateInputList('No images available. Upload a folder to get started.');
      const message = added === 1
        ? '1 image added from folder upload.'
        : `${added} images added from folder upload.`;
      setStatus(previewStatus, message, 'success');
    } else {
      setStatus(previewStatus, 'No supported image files were found in that folder.', 'error');
    }
  }

  async function convertLocalEntries(entries) {
    const wantTxt = includeTxt ? includeTxt.checked : true;
    const wantPng = includePng ? includePng.checked : false;
    if (!wantTxt && !wantPng) {
      throw new Error('Enable at least one output format before converting.');
    }
    if (typeof window.toAscii !== 'function') {
      throw new Error('Local conversion helpers are unavailable in this build.');
    }
    if (wantPng && typeof window.asciiToCanvas !== 'function') {
      throw new Error('PNG conversion requires the asciiToCanvas helper.');
    }

    const settings = gatherNumericSettings();
    const errors = [];
    const conversions = [];
    const usedBaseNames = new Set();
    const baseCounters = new Map();

    const preparedEntries = entries.map((entry, index) => {
      const displayName = entry.displayName || entry.name || `image_${index + 1}`;
      const rawBase = removeExtension(extractBaseName(displayName));
      const fallback = `image_${index + 1}`;
      const baseCandidate = sanitizeFileComponent(rawBase, fallback);

      let uniqueName = baseCandidate;
      if (usedBaseNames.has(uniqueName)) {
        let suffix = baseCounters.get(baseCandidate) || 1;
        let nextCandidate = uniqueName;
        do {
          suffix += 1;
          nextCandidate = `${baseCandidate}_${suffix}`;
        } while (usedBaseNames.has(nextCandidate));
        baseCounters.set(baseCandidate, suffix);
        uniqueName = nextCandidate;
      } else {
        baseCounters.set(baseCandidate, 1);
      }
      usedBaseNames.add(uniqueName);

      return {
        entry,
        displayName,
        uniqueName,
      };
    });

    for (const info of preparedEntries) {
      try {
        if (!info.entry.file) {
          throw new Error('Local file data is unavailable. Re-upload the folder to refresh this entry.');
        }
        const img = await loadImageFromFile(info.entry.file);
        const asciiString = await window.toAscii(img, settings);
        let pngBlob = null;
        if (wantPng) {
          const canvas = window.asciiToCanvas(asciiString, settings);
          pngBlob = await canvasToBlob(canvas);
        }
        conversions.push({
          entry: info.entry,
          displayName: info.displayName,
          uniqueName: info.uniqueName,
          ascii: wantTxt ? asciiString : null,
          pngBlob,
        });
      } catch (err) {
        const reason = err && err.message ? err.message : String(err);
        errors.push(`${info.displayName}: ${reason}`);
      }
    }

    if (!conversions.length) {
      throw new Error(errors[0] || 'No images could be converted.');
    }

    const convertedCount = conversions.length;
    const firstSuccess = conversions[0];
    const firstLabel = firstSuccess
      ? (firstSuccess.displayName || firstSuccess.entry.name || firstSuccess.uniqueName)
      : null;

    if (typeof window.JSZip === 'function') {
      const zip = new window.JSZip();
      for (const conversion of conversions) {
        if (wantTxt && conversion.ascii !== null) {
          zip.file(`${conversion.uniqueName}.txt`, conversion.ascii);
        }
        if (wantPng && conversion.pngBlob) {
          zip.file(`${conversion.uniqueName}.png`, conversion.pngBlob);
        }
      }
      if (errors.length) {
        zip.file('_errors.txt', errors.join('\n'));
      }
      const archive = await zip.generateAsync({ type: 'blob' });
      const baseLabel = firstLabel
        ? sanitizeFileComponent(removeExtension(extractBaseName(firstLabel)), 'ascii_art')
        : sanitizeFileComponent(firstSuccess.uniqueName, 'ascii_art');
      const archiveName = convertedCount === 1
        ? `${baseLabel}_ascii.zip`
        : 'ascii_selected_local.zip';
      downloadBlob(archive, archiveName);
      if (errors.length) {
        return `Converted ${convertedCount} local image(s) with ${errors.length} issue(s).`;
      }
      return convertedCount === 1
        ? `Local archive ready for ${firstLabel || baseLabel}.`
        : `Converted ${convertedCount} local images.`;
    }

    const writeErrors = await saveConversionsToDirectory(conversions, {
      wantTxt,
      wantPng,
    });
    const totalIssues = errors.length + writeErrors.length;
    if (totalIssues) {
      return `Converted ${convertedCount} local image(s) with ${totalIssues} issue(s).`;
    }
    if (convertedCount === 1) {
      return firstLabel
        ? `Saved files for ${firstLabel} to the selected folder.`
        : 'Saved files to the selected folder.';
    }
    return `Saved ${convertedCount} local images to the selected folder.`;
  }

  async function convertServerEntries(entries) {
    if (!backendAvailable) {
      throw new Error('Server conversion is unavailable on this host.');
    }
    const names = entries.map((entry) => entry.name);
    const payload = Object.assign({}, gatherSettingsForJson(), {
      names,
      include_txt: includeTxt ? includeTxt.checked : true,
      include_png: includePng ? includePng.checked : false,
    });
    const response = await fetch('/api/batch_input', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const blob = await ensureZipResponse(response);
    downloadBlob(blob, 'ascii_batch_input.zip');
    return entries.length === 1
      ? `Server archive downloaded for ${entries[0].name}.`
      : `Converted ${entries.length} server images.`;
  }

  async function attemptServerPreview(file) {
    if (!backendAvailable) {
      return false;
    }
    try {
      const formData = new FormData();
      if (file) {
        formData.append('file', file, file.name);
      }
      appendSettings(formData);
      const response = await fetch('/api/preview', {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          markBackendUnavailable('Preview endpoint is unavailable. Falling back to local rendering.');
          return false;
        }
        throw new Error(await extractErrorMessage(response));
      }
      const blob = await response.blob();
      revokePreviewUrl();
      previewObjectUrl = URL.createObjectURL(blob);
      previewDisplay.innerHTML = '';
      const img = document.createElement('img');
      img.alt = 'ASCII preview';
      img.src = previewObjectUrl;
      img.style.maxWidth = '100%';
      img.style.maxHeight = '100%';
      previewDisplay.appendChild(img);
      const message = file ? `Preview updated for ${file.name}.` : 'Preview refreshed.';
      setStatus(previewStatus, message, 'success');
      return true;
    } catch (err) {
      if (err instanceof TypeError) {
        markBackendUnavailable('Preview endpoint is unreachable. Falling back to local rendering.');
        return false;
      }
      if (!backendAvailable) {
        return false;
      }
      throw err;
    }
  }

  function setStatus(el, message, type) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('error', 'success');
    if (type) {
      el.classList.add(type);
    }
  }

  function gatherSettings() {
    const fgColor = normalizeColorInput(settingsForm.fg_color.value, '#ffffff');
    const bgColor = normalizeColorInput(settingsForm.bg_color.value, '#000000');
    return {
      output_width: settingsForm.output_width.value,
      font_size: settingsForm.font_size.value,
      black_threshold: settingsForm.black_threshold.value,
      char_aspect: settingsForm.char_aspect.value,
      fg_color: fgColor,
      bg_color: bgColor,
      ascii_chars: settingsForm.ascii_chars.value,
      font_path: settingsForm.font_path.value,
      invert: settingsForm.invert.checked ? 'true' : 'false'
    };
  }

  function appendSettings(formData) {
    const values = gatherSettings();
    Object.entries(values).forEach(([key, value]) => {
      if (key === 'ascii_chars') {
        formData.append(key, value);
        return;
      }
      if (key === 'invert') {
        formData.append(key, value);
        return;
      }
      if (key === 'font_path') {
        if (typeof value === 'string' && value.trim()) {
          formData.append(key, value.trim());
        }
        return;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          formData.append(key, trimmed);
        }
        return;
      }
      if (value !== undefined && value !== null) {
        formData.append(key, value);
      }
    });
  }

  function gatherSettingsForJson() {
    const payload = {};
    const widthRaw = settingsForm.output_width.value;
    if (widthRaw.trim()) {
      const width = Number(widthRaw);
      if (Number.isFinite(width)) {
        payload.output_width = width;
      }
    }
    const fontSizeRaw = settingsForm.font_size.value;
    if (fontSizeRaw.trim()) {
      const fontSize = Number(fontSizeRaw);
      if (Number.isFinite(fontSize)) {
        payload.font_size = fontSize;
      }
    }
    const thresholdRaw = settingsForm.black_threshold.value;
    if (thresholdRaw.trim()) {
      const threshold = Number(thresholdRaw);
      if (Number.isFinite(threshold)) {
        payload.black_threshold = threshold;
      }
    }
    const aspectRaw = settingsForm.char_aspect.value;
    if (aspectRaw.trim()) {
      const aspect = Number(aspectRaw);
      if (Number.isFinite(aspect)) {
        payload.char_aspect = aspect;
      }
    }
    const fg = normalizeColorInput(settingsForm.fg_color.value, '#ffffff');
    if (fg) {
      payload.fg_color = fg;
    }
    const bg = normalizeColorInput(settingsForm.bg_color.value, '#000000');
    if (bg) {
      payload.bg_color = bg;
    }
    const asciiChars = settingsForm.ascii_chars.value;
    payload.ascii_chars = asciiChars;
    const fontPath = settingsForm.font_path.value.trim();
    if (fontPath) {
      payload.font_path = fontPath;
    }
    payload.invert = settingsForm.invert.checked;
    return payload;
  }

  function revokePreviewUrl() {
    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }
  }

  async function loadDefaults() {
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          markBackendUnavailable('Backend settings endpoint is unavailable. Using built-in defaults.');
          return;
        }
        return;
      }
      const data = await response.json();
      if (data.output_width !== undefined) {
        settingsForm.output_width.value = data.output_width;
      }
      if (data.font_size !== undefined) {
        settingsForm.font_size.value = data.font_size;
      }
      if (data.black_threshold !== undefined) {
        settingsForm.black_threshold.value = data.black_threshold;
      }
      if (data.char_aspect !== undefined) {
        settingsForm.char_aspect.value = data.char_aspect;
      }
      if (typeof data.fg_color === 'string') {
        settingsForm.fg_color.value = normalizeColorInput(data.fg_color, settingsForm.fg_color.value);
      }
      if (typeof data.bg_color === 'string') {
        settingsForm.bg_color.value = normalizeColorInput(data.bg_color, settingsForm.bg_color.value);
      }
      if (typeof data.ascii_chars === 'string') {
        settingsForm.ascii_chars.value = data.ascii_chars;
      }
      if (typeof data.font_path === 'string') {
        settingsForm.font_path.value = data.font_path;
      }
    } catch (err) {
      markBackendUnavailable('Backend API could not be reached. Using built-in defaults.');
    }
  }

  function buildInputItems() {
    const items = [];
    serverInputItems.forEach((name) => {
      items.push({
        id: `server:${name}`,
        source: 'server',
        name,
        displayName: name,
      });
    });
    localInputFiles.forEach((entry, key) => {
      items.push({
        id: `local:${key}`,
        source: 'local',
        name: key,
        displayName: entry.displayName,
        file: entry.file,
      });
    });
    items.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }));
    return items;
  }

  function renderInputList(items, emptyMessage) {
    inputEntryStore.clear();
    inputListEl.innerHTML = '';
    inputListEl.classList.remove('empty');
    if (!items.length) {
      inputListEl.classList.add('empty');
      const span = document.createElement('span');
      span.textContent = emptyMessage || 'No images available. Upload a folder to get started.';
      inputListEl.appendChild(span);
      return;
    }
    items.forEach((item, index) => {
      inputEntryStore.set(item.id, item);
      const checkboxId = `input-${index}`;
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = checkboxId;
      checkbox.name = 'inputSelection';
      checkbox.dataset.entryId = item.id;
      const span = document.createElement('span');
      span.textContent = item.source === 'local' ? `${item.displayName} (local)` : item.displayName;
      label.appendChild(checkbox);
      label.appendChild(span);
      inputListEl.appendChild(label);
    });
  }

  function updateInputList(emptyMessage) {
    renderInputList(buildInputItems(), emptyMessage);
  }

  function showInputMessage(message) {
    renderInputList(buildInputItems(), message);
  }

  async function refreshInputList() {
    if (!backendAvailable) {
      updateInputList('Upload a folder to add images.');
      return;
    }
    showInputMessage('Loading input folder...');
    try {
      const response = await fetch('/api/list_input');
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          markBackendUnavailable('Backend input listing endpoint is unavailable.');
          return;
        }
        const message = await extractErrorMessage(response);
        showInputMessage(message || 'Failed to load input folder.');
        return;
      }
      const data = await response.json();
      serverInputItems.length = 0;
      if (Array.isArray(data.files)) {
        data.files.forEach((name) => {
          if (typeof name === 'string' && name.trim()) {
            serverInputItems.push(name.trim());
          }
        });
      }
      updateInputList('No images in the backend input folder. Upload a folder to add your own images.');
    } catch (err) {
      markBackendUnavailable('Backend API could not be reached. Running in local-only mode.');
    }
  }

  function getSelectedEntries() {
    const boxes = inputListEl.querySelectorAll('input[type="checkbox"]');
    const selected = [];
    boxes.forEach((box) => {
      if (!box.checked) {
        return;
      }
      const entryId = box.dataset.entryId;
      if (!entryId) {
        return;
      }
      const entry = inputEntryStore.get(entryId);
      if (entry) {
        selected.push(entry);
      }
    });
    return selected;
  }

  function setInputSelection(all) {
    const boxes = inputListEl.querySelectorAll('input[type="checkbox"]');
    boxes.forEach((box) => {
      box.checked = Boolean(all);
    });
  }

  function ensureOutputsSelected() {
    if (includeTxt.checked || includePng.checked) {
      return true;
    }
    setStatus(batchStatus, 'Enable at least one output format.', 'error');
    return false;
  }

  async function ensureZipResponse(response) {
    if (!response.ok) {
      if (response.status === 404 || response.status === 405) {
        markBackendUnavailable('Batch conversion endpoints are unavailable on this host.');
        throw new Error('Batch conversion endpoints are unavailable on this host.');
      }
      throw new Error(await extractErrorMessage(response));
    }
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      throw new Error(await extractErrorMessage(response));
    }
    return response.blob();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function requestPreview(file) {
    previewButton.disabled = true;
    setStatus(previewStatus, 'Rendering preview...', '');
    applyPreviewDimensions();
    previewDisplay.innerHTML = '<span>Rendering preview...</span>';
    try {
      const handledByServer = await attemptServerPreview(file);
      if (handledByServer) {
        return;
      }
      await renderPreviewLocally(file);
      const label = lastLocalImageName
        ? `Preview generated locally for ${lastLocalImageName}.`
        : 'Preview generated locally.';
      setStatus(previewStatus, label, 'success');
    } catch (err) {
      previewDisplay.innerHTML = '<span>Preview failed.</span>';
      setStatus(previewStatus, err.message || 'Preview failed.', 'error');
      throw err;
    } finally {
      previewButton.disabled = false;
    }
  }

  previewForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = previewFile.files[0];
    if (!file) {
      setStatus(previewStatus, 'Select an image or preview one from the input folder.', 'error');
      return;
    }
    try {
      await requestPreview(file);
    } catch (err) {
      // status already updated
    }
  });

  refreshInputBtn.addEventListener('click', () => {
    refreshInputList();
  });

  selectAllBtn.addEventListener('click', () => {
    setInputSelection(true);
  });

  clearSelectionBtn.addEventListener('click', () => {
    setInputSelection(false);
  });

  previewSelectedBtn.addEventListener('click', async () => {
    const entries = getSelectedEntries();
    if (!entries.length) {
      setStatus(previewStatus, 'Select at least one input image to preview.', 'error');
      return;
    }
    const entry = entries[0];
    if (entry.source === 'local') {
      try {
        await renderPreviewLocally(entry.file);
        const message = entry.displayName
          ? `Preview generated locally for ${entry.displayName}.`
          : 'Preview generated locally.';
        setStatus(previewStatus, message, 'success');
      } catch (err) {
        setStatus(previewStatus, err.message || 'Failed to preview selected image.', 'error');
      }
      return;
    }
    if (!backendAvailable) {
      setStatus(previewStatus, 'Input-folder preview requires the backend API (not available on this host).', 'error');
      return;
    }
    const target = entry.name;
    try {
      const body = new URLSearchParams();
      body.append('name', target);
      const response = await fetch('/api/select', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          markBackendUnavailable('Input selection endpoint is unavailable on this host.');
          setStatus(previewStatus, 'Input-folder preview is not available without the backend API.', 'error');
          return;
        }
        throw new Error(await extractErrorMessage(response));
      }
      await requestPreview();
    } catch (err) {
      setStatus(previewStatus, err.message || 'Failed to preview selected image.', 'error');
    }
  });

  batchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!backendAvailable) {
      setStatus(batchStatus, 'Batch conversion requires the backend API and is unavailable on this site.', 'error');
      return;
    }
    if (!ensureOutputsSelected()) {
      return;
    }
    const files = Array.from(batchFiles.files || []);
    if (!files.length) {
      setStatus(batchStatus, 'Choose at least one file to batch convert.', 'error');
      return;
    }
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file, file.name);
    });
    appendSettings(formData);
    formData.append('include_txt', includeTxt.checked ? '1' : '0');
    formData.append('include_png', includePng.checked ? '1' : '0');
    setStatus(batchStatus, 'Converting uploaded files...', '');
    setBatchButtonsDisabled(true);
    try {
      const response = await fetch('/api/batch_upload', {
        method: 'POST',
        body: formData
      });
      const blob = await ensureZipResponse(response);
      downloadBlob(blob, 'ascii_batch_upload.zip');
      setStatus(batchStatus, 'Batch archive ready.', 'success');
    } catch (err) {
      setStatus(batchStatus, err.message || 'Batch conversion failed.', 'error');
    } finally {
      setBatchButtonsDisabled(false);
    }
  });

  convertInputBtn.addEventListener('click', async () => {
    if (!ensureOutputsSelected()) {
      return;
    }
    const entries = getSelectedEntries();
    if (!entries.length) {
      setStatus(batchStatus, 'Select at least one input image to convert.', 'error');
      return;
    }

    const localEntries = entries.filter((entry) => entry.source === 'local');
    const serverEntries = entries.filter((entry) => entry.source === 'server');
    if (!localEntries.length && serverEntries.length && !backendAvailable) {
      setStatus(batchStatus, 'Server conversion requires the backend API, which is unavailable on this site.', 'error');
      return;
    }

    setStatus(batchStatus, 'Converting selected images...', '');
    setBatchButtonsDisabled(true);

    const successes = [];
    const failures = [];

    try {
      if (localEntries.length) {
        try {
          const message = await convertLocalEntries(localEntries);
          successes.push(message);
        } catch (err) {
          failures.push(err && err.message ? err.message : String(err));
        }
      }

      if (serverEntries.length) {
        if (!backendAvailable) {
          failures.push('Server images skipped because the backend API is unavailable.');
        } else {
          try {
            const message = await convertServerEntries(serverEntries);
            successes.push(message);
          } catch (err) {
            failures.push(err && err.message ? err.message : String(err));
          }
        }
      }

      if (failures.length && successes.length) {
        setStatus(batchStatus, `${successes.join(' ')} Issues: ${failures.join(' ')}`, 'error');
      } else if (failures.length) {
        setStatus(batchStatus, failures.join(' '), 'error');
      } else if (successes.length) {
        setStatus(batchStatus, successes.join(' '), 'success');
      } else {
        setStatus(batchStatus, 'Nothing was converted.', 'error');
      }
    } finally {
      setBatchButtonsDisabled(false);
    }
  });

  if (uploadFolderBtn && folderPicker) {
    uploadFolderBtn.addEventListener('click', () => {
      folderPicker.click();
    });
    folderPicker.addEventListener('change', () => {
      const files = Array.from(folderPicker.files || []);
      addLocalFolderFiles(files);
      folderPicker.value = '';
    });
  }

  [previewWidthInput, previewHeightInput].forEach((input) => {
    if (!input) {
      return;
    }
    input.addEventListener('input', applyPreviewDimensions);
  });

  setBatchButtonsDisabled(false);
  updateInputList('No images yet. Upload a folder to add images.');
  applyPreviewDimensions();
  loadDefaults();
  refreshInputList();
  window.addEventListener('beforeunload', () => {
    revokePreviewUrl();
  });
})();
