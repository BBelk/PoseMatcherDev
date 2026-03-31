const referenceBox = document.getElementById('reference-box');
const referenceImg = document.getElementById('reference-img');
const fileInput = document.getElementById('file-input');
const clearBtn = document.getElementById('clear-btn');

// --- File input ---

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadReferenceImage(file);
});

// --- Drag and drop ---

referenceBox.addEventListener('dragover', (e) => {
  e.preventDefault();
  referenceBox.classList.add('dragover');
});

referenceBox.addEventListener('dragleave', () => {
  referenceBox.classList.remove('dragover');
});

referenceBox.addEventListener('drop', (e) => {
  e.preventDefault();
  referenceBox.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    loadReferenceImage(file);
  }
});

// --- Click anywhere on box to upload (when empty) ---

referenceBox.addEventListener('click', (e) => {
  if (e.target.closest('#upload-label') || e.target === fileInput) return;
  if (!referenceBox.classList.contains('has-image') && e.target !== clearBtn) {
    fileInput.click();
  }
});

// --- Clear ---

clearBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  referenceImg.src = '';
  referenceBox.classList.remove('has-image');
  fileInput.value = '';
});

// --- Load image ---

function loadReferenceImage(file) {
  const url = URL.createObjectURL(file);
  referenceImg.onload = () => {
    URL.revokeObjectURL(url);
    referenceBox.classList.add('has-image');
  };
  referenceImg.src = url;
}
