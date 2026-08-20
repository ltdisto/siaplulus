# SiapLulus — Setup Checklist

Struktur ini adalah adaptasi dari project AR-AI Anda sebelumnya, disesuaikan dengan
spesifikasi SiapLulus (opening baru, menu Petunjuk/Materi/Video, AR 3D+audio, dsb).

## 1. Google Sheet BARU
- Buat spreadsheet Google Sheets baru khusus SiapLulus.
- Buka menu **Extensions > Apps Script**, hapus isi default, lalu tempel isi `code.gs`.
- Di Project Settings (ikon gerigi) → **Script Properties**, tambahkan:
  - `ADMIN_PASSWORD` = `BRIGHT`
  - `GEMINI_API_KEY` = (API key Gemini Anda — boleh sama dengan project lama untuk tahap awal)
- Deploy sebagai **Web App** (Execute as: Me, Who has access: Anyone).
- Salin URL Web App yang dihasilkan.

## 2. app.js
- Ganti baris `const urlScript = "GANTI_DENGAN_URL_APPS_SCRIPT_SIAPLULUS";` dengan URL Web App dari langkah 1.
- Ganti URL di `bukaDatabase()` dengan link Google Sheet BARU Anda (bukan yang lama).

## Update Terbaru
- **Logo**: `logo-siaplulus.png` diproses ulang dengan outline putih rapi (bercak putih dari
  proses hapus background sebelumnya sudah diperbaiki). `logo-uny.png` ditambahkan berdampingan
  dengan logo SiapLulus di halaman Opening dan Login.
- **Bug Inventor tak terlihat di HP**: sudah diperbaiki. Penyebabnya `100vh` di CSS yang di
  banyak browser mobile menghitung tinggi termasuk area di belakang address bar. Sudah diganti
  ke `100dvh` (dynamic viewport height) + fallback scroll otomatis kalau layar sangat pendek.
- **Menu Utama**: didesain ulang jadi gaya "Dashboard Card" — grid 2 kolom dengan ikon per menu,
  kartu "Mulai Asesmen" ditonjolkan (lebar penuh), header dengan avatar inisial nama siswa, dan
  progress bar jumlah marker yang sudah diselesaikan.
- **Halaman Materi**: didesain ulang total jadi gaya LMS premium — tab horizontal per dimensi
  (bisa di-scroll di HP), konten dipisah jelas jadi bagian "Deskripsi" dan "Aplikasi dalam
  Pembelajaran" dengan card berbeda, progress bar dimensi, tombol Sebelumnya/Selanjutnya, font
  Inter untuk keterbacaan lebih baik, dan smooth scroll. Seluruh isi 8 dimensi sudah diambil
  dari file Word `Materi_Profil_LulusanSiapLulus.docx` yang Anda kirim, disimpan di
  `materi-data.js` (silakan edit file ini langsung kalau ada revisi teks materi nanti).

## 3. Status Aset
✅ **SUDAH LENGKAP** — semua aset berikut sudah tersedia di dalam folder ini, tidak perlu
ditambahkan lagi:
- `logo-siaplulus.png` — logo (background sudah dihapus/transparan)
- `mind1.mind` — target image MindAR, hasil compile dari 8 kartu marker Anda
- `soal1.mp3` s.d. `soal8.mp3` — audio penjelasan tiap marker (urutan: 1=Keimanan dan
  Ketakwaan, 2=Kewargaan, 3=Penalaran Kritis, 4=Kreativitas, 5=Kolaborasi, 6=Kemandirian,
  7=Kesehatan, 8=Komunikasi)
- 8 file `*_final.glb` — model 3D hasil optimasi (mesh + tekstur dikompres, total ~589MB
  menjadi ~31MB), sudah dirujuk otomatis di `index.html`

❌ **Yang masih perlu Anda lengkapi:**
- Isi teks pada menu **Materi** (`id="materi-body"` di `index.html`) masih placeholder umum,
  sesuaikan dengan materi delapan dimensi Profil Lulusan versi lengkap Anda.
- Video di menu **Video** (`id="video-embed"` di `index.html`) masih memakai video contoh,
  ganti dengan video pembelajaran resmi SiapLulus.
- Cek kembali `scale`/`position` masing-masing `<a-gltf-model>` di `index.html` bagian
  `<a-scene>` setelah tes langsung di kamera — kemungkinan perlu disesuaikan per model karena
  ukuran asli tiap model 3D bisa berbeda-beda.

## 4. Bank Soal
- Saat pertama kali menu **Editor Soal** / asesmen diakses, sheet "Bank Soal" akan otomatis
  terisi 24 soal placeholder (3 soal x 8 marker), semuanya berlabel "menyusul".
- Edit langsung lewat menu **Editor Soal** di Admin, atau langsung di Google Sheets tab "Bank Soal".

## 5. Video pembelajaran
- Ganti URL embed YouTube di `index.html` pada elemen `id="video-embed"` dan judul di
  `id="video-judul"` sesuai video pembelajaran resmi SiapLulus.

## 6. Materi
- Konten teks materi (delapan dimensi Profil Lulusan) masih placeholder di `id="materi-body"`
  pada `index.html`, silakan disesuaikan.

## Alur AR (berbeda dari versi lama)
Versi lama: video AR otomatis membuka kuis saat video selesai diputar ("ended").
Versi SiapLulus ini: begitu marker terdeteksi, gambar AR 3D langsung tampil dan audio
otomatis diputar, LALU tombol **Next** (mengambang di bawah layar kamera) muncul untuk
siswa tekan kapan pun ia siap menjawab 3 pertanyaan marker tersebut — sesuai spesifikasi
"tombol Next untuk mentrigger pertanyaan".
