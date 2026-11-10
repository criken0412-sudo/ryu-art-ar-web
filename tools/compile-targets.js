import { Compiler } from 'mind-ar/src/image-target/compiler.js';

const status = document.querySelector('#status');
const button = document.querySelector('#compile');
const files = [
  '/media/work-0.jpg', '/media/work-1.jpg', '/media/work-2.jpg',
  '/media/work-3.jpg', '/media/work-4.jpg', '/media/work-5.png',
];

async function loadImage(source) {
  const response = await fetch(source);
  if (!response.ok) throw new Error(`画像を読み込めません: ${source}`);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    status.textContent = '6作品の画像を読み込み中…';
    const images = await Promise.all(files.map(loadImage));
    const compiler = new Compiler();
    await compiler.compileImageTargets(images, (progress) => {
      status.textContent = `画像認識データを作成中… ${Math.round(progress)}%`;
    });
    const data = compiler.exportData();
    const saved = await fetch('/__compile-targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    if (!saved.ok) throw new Error(await saved.text());
    status.textContent = `完了。${await saved.text()}`;
  } catch (error) {
    status.textContent = `作成できませんでした: ${error.message}`;
    button.disabled = false;
  }
});

if (new URLSearchParams(location.search).has('run')) button.click();
