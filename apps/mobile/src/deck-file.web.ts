export async function saveDeckCsv(name: string, contents: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function pickDeckCsv(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (value: string | null) => {
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return done(null);
      if (file.size > 1_000_000) {
        input.remove();
        reject(new Error('File CSV vượt quá 1 MB.'));
        return;
      }
      file.text().then(done, reject);
    });
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}
