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
  const selectAllBtn = document.getElementById('selectAllInput');
  const clearSelectionBtn = document.getElementById('clearInputSelection');
  const previewSelectedBtn = document.getElementById('previewSelected');
  const convertInputBtn = document.getElementById('convertInput');

  if (!settingsForm || !previewForm || !batchForm) {
    console.warn('ASCII Generator web UI could not initialise: required elements are missing.');
    return;
  }

  let previewObjectUrl = null;

  function setStatus(el, message, type) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.remove('error', 'success');
    if (type) {
      el.classList.add(type);
    }
  }

  function gatherSettings() {
    return {
      output_width: settingsForm.output_width.value,
      font_size: settingsForm.font_size.value,
      black_threshold: settingsForm.black_threshold.value,
      char_aspect: settingsForm.char_aspect.value,
      fg_color: settingsForm.fg_color.value,
      bg_color: settingsForm.bg_color.value,
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
    const fg = settingsForm.fg_color.value.trim();
    if (fg) {
      payload.fg_color = fg;
    }
    const bg = settingsForm.bg_color.value.trim();
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
        settingsForm.fg_color.value = data.fg_color;
      }
      if (typeof data.bg_color === 'string') {
        settingsForm.bg_color.value = data.bg_color;
      }
      if (typeof data.ascii_chars === 'string') {
        settingsForm.ascii_chars.value = data.ascii_chars;
      }
      if (typeof data.font_path === 'string') {
        settingsForm.font_path.value = data.font_path;
      }
      settingsForm.invert.checked = Boolean(data.invert);
    } catch (err) {
      console.warn('Failed to load defaults', err);
    }
  }

  function renderInputList(items) {
    inputListEl.innerHTML = '';
    inputListEl.classList.remove('empty');
    if (!items.length) {
      inputListEl.classList.add('empty');
      inputListEl.innerHTML = '<span>No images in input folder.</span>';
      return;
    }
    items.forEach((name, index) => {
      const id = `input-${index}`;
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = name;
      checkbox.id = id;
      checkbox.name = 'inputSelection';
      const span = document.createElement('span');
      span.textContent = name;
      label.appendChild(checkbox);
      label.appendChild(span);
      inputListEl.appendChild(label);
    });
  }

  function renderInputError(message) {
    inputListEl.innerHTML = '';
    inputListEl.classList.add('empty');
    const span = document.createElement('span');
    span.textContent = message;
    inputListEl.appendChild(span);
  }

  async function refreshInputList() {
    renderInputError('Loading input folder...');
    try {
      const response = await fetch('/api/list_input');
      if (!response.ok) {
        const text = await response.text();
        renderInputError(text || 'Failed to load input folder.');
        return;
      }
      const data = await response.json();
      renderInputList(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      renderInputError(err.message || 'Failed to load input folder.');
    }
  }

  function getSelectedInputNames() {
    const boxes = inputListEl.querySelectorAll('input[type="checkbox"]');
    const selected = [];
    boxes.forEach((box) => {
      if (box.checked) {
        selected.push(box.value);
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
      let message = `${response.status} ${response.statusText}`;
      try {
        const data = await response.json();
        if (data && data.error) {
          message = data.error;
        }
      } catch (err) {
        const text = await response.text();
        if (text) {
          message = text;
        }
      }
      throw new Error(message);
    }
    const contentType = response.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      const message = (data && data.error) || 'Unexpected JSON response from server.';
      throw new Error(message);
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
    previewDisplay.innerHTML = '<span>Rendering preview...</span>';
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
        let message = `${response.status} ${response.statusText}`;
        try {
          const data = await response.json();
          if (data && data.error) {
            message = data.error;
          }
        } catch (err) {
          const text = await response.text();
          if (text) {
            message = text;
          }
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      revokePreviewUrl();
      previewObjectUrl = URL.createObjectURL(blob);
      previewDisplay.innerHTML = '';
      const img = document.createElement('img');
      img.alt = 'ASCII preview';
      img.src = previewObjectUrl;
      previewDisplay.appendChild(img);
      const message = file ? `Preview updated for ${file.name}.` : 'Preview refreshed.';
      setStatus(previewStatus, message, 'success');
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
    const selected = getSelectedInputNames();
    if (!selected.length) {
      setStatus(previewStatus, 'Select at least one input image to preview.', 'error');
      return;
    }
    const target = selected[0];
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
        let message = `${response.status} ${response.statusText}`;
        try {
          const data = await response.json();
          if (data && data.error) {
            message = data.error;
          }
        } catch (err) {
          const text = await response.text();
          if (text) {
            message = text;
          }
        }
        throw new Error(message);
      }
      await requestPreview();
    } catch (err) {
      setStatus(previewStatus, err.message || 'Failed to preview selected image.', 'error');
    }
  });

  batchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
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
    batchForm.querySelectorAll('button').forEach((btn) => {
      btn.disabled = true;
    });
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
      batchForm.querySelectorAll('button').forEach((btn) => {
        btn.disabled = false;
      });
    }
  });

  convertInputBtn.addEventListener('click', async () => {
    if (!ensureOutputsSelected()) {
      return;
    }
    const names = getSelectedInputNames();
    if (!names.length) {
      setStatus(batchStatus, 'Select at least one input image to convert.', 'error');
      return;
    }
    const payload = Object.assign({}, gatherSettingsForJson(), {
      names,
      include_txt: includeTxt.checked,
      include_png: includePng.checked
    });
    setStatus(batchStatus, 'Converting input folder selection...', '');
    batchForm.querySelectorAll('button').forEach((btn) => {
      btn.disabled = true;
    });
    try {
      const response = await fetch('/api/batch_input', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const blob = await ensureZipResponse(response);
      downloadBlob(blob, 'ascii_batch_input.zip');
      setStatus(batchStatus, 'Batch archive ready.', 'success');
    } catch (err) {
      setStatus(batchStatus, err.message || 'Batch conversion failed.', 'error');
    } finally {
      batchForm.querySelectorAll('button').forEach((btn) => {
        btn.disabled = false;
      });
    }
  });

  loadDefaults();
  refreshInputList();
  window.addEventListener('beforeunload', () => {
    revokePreviewUrl();
  });
})();
