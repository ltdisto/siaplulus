// ========================================================================
// SIAPLULUS — Apps Script backend
// PENTING: gunakan Google Sheet BARU (khusus SiapLulus), jangan sheet lama.
// Setelah deploy sebagai Web App, salin URL-nya ke variabel `urlScript`
// di app.js.
//
// Script Properties yang WAJIB diset (Project Settings -> Script Properties):
//   ADMIN_PASSWORD = BRIGHT   (atau password admin lain sesuai keputusan Anda)
//   GEMINI_API_KEY  = (API key Gemini Anda; boleh sama dengan project lama)
// ========================================================================

function doPost(e) {
  try {
    var action = e.parameter.action;
    if (action === 'chat') {
      return handleChatAI(e);
    }
    if (action === 'validateAdmin') {
      return handleValidateAdmin(e);
    }
    if (action === 'addSekolah') {
      return handleAddSekolah(e);
    }
    if (action === 'updateSoal') {
      return handleUpdateSoal(e);
    }
    if (action === 'generateRekomendasi') {
      return handleGenerateRekomendasi(e);
    }

    // ----- default: simpan hasil asesmen -----
    // FORMAT KOLOM DINAMIS: Jawaban1, Skor1, Jawaban2, Skor2, ..., memanjang ke kanan
    // sesuai jumlah soal saat siswa submit (default: 24 soal = 3 soal x 8 marker).
    var submissionId = e.parameter.submissionId || '';
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    if (submissionId) {
      var existingData = sheet.getDataRange().getValues();
      for (var r = 1; r < existingData.length; r++) {
        if (existingData[r][6] === submissionId) {
          return ContentService.createTextOutput(JSON.stringify({ result: 'success', duplicate: true }))
                               .setMimeType(ContentService.MimeType.JSON);
        }
      }
    }

    var jawabanSkorPairs = [];
    var n = 1;
    while (e.parameter['Jawaban' + n] !== undefined) {
      jawabanSkorPairs.push(e.parameter['Jawaban' + n]);
      jawabanSkorPairs.push(e.parameter['Skor' + n] || '0');
      n++;
    }
    var jumlahSoal = n - 1;

    ensureHeaderColumns(sheet, jumlahSoal);

    var waktu = new Date();
    var row = [
      waktu,
      e.parameter.Nama,
      e.parameter.Kelas,
      e.parameter.Jurusan,
      e.parameter.Sekolah,
      e.parameter.TotalSkor,
      submissionId,
      jumlahSoal,
    ].concat(jawabanSkorPairs);

    sheet.appendRow(row);

    return ContentService.createTextOutput(JSON.stringify({ result: 'success' }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: error.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

function ensureHeaderColumns(sheet, jumlahSoal) {
  var totalKolomDibutuhkan = 8 + (jumlahSoal * 2);
  var lastCol = Math.max(sheet.getLastColumn(), totalKolomDibutuhkan);
  var headerRange = sheet.getRange(1, 1, 1, lastCol);
  var header = headerRange.getValues()[0];

  var fixedHeaders = ['Waktu', 'Nama', 'Kelas', 'Jurusan', 'Sekolah', 'TotalSkor', 'SubmissionID', 'JumlahSoal'];
  var changed = false;

  for (var h = 0; h < fixedHeaders.length; h++) {
    if (header[h] !== fixedHeaders[h]) { header[h] = fixedHeaders[h]; changed = true; }
  }
  for (var q = 1; q <= jumlahSoal; q++) {
    var jIdx = 8 + (q - 1) * 2;
    var sIdx = jIdx + 1;
    if (header[jIdx] !== 'Jawaban' + q) { header[jIdx] = 'Jawaban' + q; changed = true; }
    if (header[sIdx] !== 'Skor' + q) { header[sIdx] = 'Skor' + q; changed = true; }
  }

  if (changed) {
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
  }
}

function doGet(e) {
  try {
    var action = e.parameter.action;

    if (action === 'hasil') {
      return getHasilSiswa(e.parameter.nama, e.parameter.kelas, e.parameter.sekolah);
    }
    if (action === 'leaderboard') {
      return handleGetLeaderboard(e);
    }
    if (action === 'getSekolahList') {
      return handleGetSekolahList();
    }
    if (action === 'getSoal') {
      return handleGetSoal();
    }

    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Unknown action' }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: error.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

function getHasilSiswa(nama, kelas, sekolah) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();

  var normalize = function (s) { return (s || '').toString().trim().toLowerCase(); };
  var targetNama = normalize(nama);
  var targetKelas = normalize(kelas);
  var targetSekolah = normalize(sekolah);

  var lastMatch = null;

  for (var r = data.length - 1; r >= 1; r--) {
    var row = data[r];
    if (normalize(row[1]) === targetNama && normalize(row[2]) === targetKelas && normalize(row[4]) === targetSekolah) {
      lastMatch = row;
      break;
    }
  }

  if (!lastMatch) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'not_found' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  var jumlahSoal = Number(lastMatch[7]) || 0;
  var jawaban = [];
  for (var q = 0; q < jumlahSoal; q++) {
    var jIdx = 8 + (q * 2);
    var sIdx = jIdx + 1;
    jawaban.push({
      jawabanText: lastMatch[jIdx] || '',
      skor: Number(lastMatch[sIdx]) || 0,
    });
  }

  var result = {
    result: 'success',
    nama: lastMatch[1],
    kelas: lastMatch[2],
    jurusan: lastMatch[3],
    sekolah: lastMatch[4],
    total: Number(lastMatch[5]) || 0,
    jawaban: jawaban,
  };

  return ContentService.createTextOutput(JSON.stringify(result))
                       .setMimeType(ContentService.MimeType.JSON);
}

// ================= CHATBOT AI (Gemini) UNTUK TANYA AI DI REKOMENDASI =================
// PENTING: API key TIDAK ditulis langsung di sini. Simpan lewat:
// Project Settings (ikon gerigi) -> Script Properties -> Add script property
// Nama: GEMINI_API_KEY   Nilai: (paste API key Gemini Anda)
function handleChatAI(e) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return ContentService.createTextOutput(JSON.stringify({
        result: 'error',
        message: 'GEMINI_API_KEY belum diset di Script Properties. Buka Project Settings -> Script Properties.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var pertanyaan = e.parameter.pertanyaan || '';
    var namaSiswa = e.parameter.nama || 'Siswa';
    var dimensi = e.parameter.dimensi || '';
    var rekomendasi = e.parameter.rekomendasi || '';
    var skor = e.parameter.skor || '';

    if (!pertanyaan.trim()) {
      return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Pertanyaan kosong.' }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    var systemInstruction =
      'Kamu adalah asisten AI pendamping siswa dalam platform SiapLulus, sebuah media pembelajaran ' +
      'delapan dimensi Profil Lulusan yang bertujuan mendukung generasi unggul dengan karakter dan ' +
      'kompetensi yang holistik. Tugasmu membantu siswa memahami rekomendasi evaluasi yang mereka ' +
      'terima, dan memberi saran praktis yang mudah diterapkan di kehidupan sehari-hari siswa. ' +
      'Jawab dengan bahasa Indonesia yang ramah, singkat (maksimal sekitar 120 kata), dan mendukung, ' +
      'bukan menghakimi. Fokus utama pembahasan adalah seputar karakter, sikap, nilai-nilai dimensi ' +
      'Profil Lulusan, pertemanan, dan pengembangan diri siswa. Kamu boleh menjawab pertanyaan yang ' +
      'relevan meski tidak persis soal delapan dimensi (misalnya siswa curhat soal pertemanan atau ' +
      'motivasi belajar), tapi jika pertanyaan sama sekali di luar topik pendidikan/pengembangan ' +
      'karakter (misalnya minta jawaban PR mata pelajaran lain, atau topik tidak pantas), arahkan ' +
      'dengan sopan kembali ke topik evaluasi.';

    var konteks =
      'Konteks: Siswa bernama ' + namaSiswa + ' sedang membahas hasil evaluasi pada dimensi "' + dimensi +
      '" dengan skor ' + skor + '/5. Rekomendasi yang diberikan sistem: "' + rekomendasi + '". ' +
      'Pertanyaan siswa: ' + pertanyaan;

    var payload = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: konteks }] }],
    };

    var response = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': apiKey },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      }
    );

    var json = JSON.parse(response.getContentText());
    var jawabanAI = 'Maaf, terjadi kendala saat memproses jawaban AI.';

    if (json.candidates && json.candidates[0] && json.candidates[0].content) {
      jawabanAI = json.candidates[0].content.parts[0].text;
    } else if (json.error) {
      jawabanAI = 'Error dari Gemini API: ' + json.error.message;
    }

    return ContentService.createTextOutput(JSON.stringify({ result: 'success', jawaban: jawabanAI }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: error.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

// ================= ADMIN: VALIDASI PASSWORD (server-side, aman) =================
// PENTING: simpan password admin lewat Project Settings -> Script Properties.
// Nama: ADMIN_PASSWORD   Nilai: BRIGHT (sesuai spesifikasi SiapLulus)
function handleValidateAdmin(e) {
  var storedPassword = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  var inputPassword = e.parameter.password || '';

  if (!storedPassword) {
    return ContentService.createTextOutput(JSON.stringify({
      result: 'error',
      message: 'ADMIN_PASSWORD belum diset di Script Properties.'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  if (inputPassword === storedPassword) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'success' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Password salah.' }))
                       .setMimeType(ContentService.MimeType.JSON);
}

function isAdminPasswordValid(password) {
  var storedPassword = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  return storedPassword && password === storedPassword;
}

// ================= ADMIN: LEADERBOARD =================
function handleGetLeaderboard(e) {
  if (!isAdminPasswordValid(e.parameter.password)) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Akses ditolak.' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();

  var rows = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (!row[1]) continue;
    rows.push({
      waktu: row[0] instanceof Date ? row[0].toLocaleString('id-ID') : row[0],
      nama: row[1],
      kelas: row[2],
      jurusan: row[3],
      sekolah: row[4],
      totalSkor: Number(row[5]) || 0,
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ result: 'success', data: rows }))
                       .setMimeType(ContentService.MimeType.JSON);
}

// ================= ADMIN: DAFTAR SEKOLAH (untuk dropdown filter) =================
function getSheetDaftarSekolah() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Daftar Sekolah');
  if (!sheet) {
    sheet = ss.insertSheet('Daftar Sekolah');
  }
  return sheet;
}

function handleGetSekolahList() {
  var sheet = getSheetDaftarSekolah();
  var values = sheet.getDataRange().getValues();
  var daftar = values
    .map(function (r) { return r[0]; })
    .filter(function (v) { return v && v.toString().trim() !== ''; });

  if (daftar.length === 0) {
    var mainSheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var mainData = mainSheet.getDataRange().getValues();
    var unikSet = {};
    for (var r = 1; r < mainData.length; r++) {
      var namaSekolah = (mainData[r][4] || '').toString().trim();
      if (namaSekolah) unikSet[namaSekolah] = true;
    }
    daftar = Object.keys(unikSet);

    daftar.forEach(function (nama) {
      sheet.appendRow([nama]);
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ result: 'success', data: daftar }))
                       .setMimeType(ContentService.MimeType.JSON);
}

function handleAddSekolah(e) {
  if (!isAdminPasswordValid(e.parameter.password)) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Akses ditolak.' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  var namaSekolahBaru = (e.parameter.nama || '').trim();
  if (!namaSekolahBaru) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Nama sekolah kosong.' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  var sheet = getSheetDaftarSekolah();
  var existing = sheet.getDataRange().getValues().map(function (r) { return (r[0] || '').toString().trim().toLowerCase(); });

  if (existing.indexOf(namaSekolahBaru.toLowerCase()) !== -1) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Sekolah sudah ada di daftar.' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  sheet.appendRow([namaSekolahBaru]);

  return ContentService.createTextOutput(JSON.stringify({ result: 'success' }))
                       .setMimeType(ContentService.MimeType.JSON);
}

// ================= BANK SOAL (Editor Soal Admin) =================
// Sheet "Bank Soal", 1 baris = 1 butir soal.
// Kolom: No | Marker(0-7) | Dimensi | Pertanyaan | OpsiA | SkorA | OpsiB | SkorB |
//        OpsiC | SkorC | OpsiD | SkorD | OpsiE | SkorE | Rekomendasi
function getSheetBankSoal() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Bank Soal');
  if (!sheet) {
    sheet = ss.insertSheet('Bank Soal');
    sheet.appendRow(['No', 'Marker', 'Dimensi', 'Pertanyaan', 'OpsiA', 'SkorA', 'OpsiB', 'SkorB',
                      'OpsiC', 'SkorC', 'OpsiD', 'SkorD', 'OpsiE', 'SkorE', 'Rekomendasi']);
  }
  return sheet;
}

// Seed PLACEHOLDER: 24 soal (3 soal x 8 marker), semuanya "menyusul" sampai
// naskah soal final SiapLulus tersedia dan diisi lewat Editor Soal / Sheet langsung.
function getSeedDataBankSoal() {
  var seed = [];
  var dimensiPlaceholder = 'Menyusul';
  for (var marker = 0; marker < 8; marker++) {
    for (var soalKe = 1; soalKe <= 3; soalKe++) {
      seed.push([
        marker, dimensiPlaceholder,
        '[PLACEHOLDER] Pertanyaan ke-' + soalKe + ' untuk marker ' + (marker + 1) + ' menyusul.',
        'Opsi A (menyusul)', 1, 'Opsi B (menyusul)', 2, 'Opsi C (menyusul)', 3, 'Opsi D (menyusul)', 4, 'Opsi E (menyusul)', 5,
        'Rekomendasi menyusul setelah naskah soal final tersedia.'
      ]);
    }
  }
  return seed;
}

function handleGetSoal() {
  var sheet = getSheetBankSoal();
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    var seed = getSeedDataBankSoal();
    seed.forEach(function (row, idx) {
      sheet.appendRow([idx + 1].concat(row));
    });
    lastRow = sheet.getLastRow();
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  var soalList = values.map(function (row) {
    return {
      no: row[0],
      marker: Number(row[1]),
      dimensi: row[2],
      pertanyaan: row[3],
      opsi: [
        { key: 'a', text: row[4], skor: Number(row[5]) },
        { key: 'b', text: row[6], skor: Number(row[7]) },
        { key: 'c', text: row[8], skor: Number(row[9]) },
        { key: 'd', text: row[10], skor: Number(row[11]) },
        { key: 'e', text: row[12], skor: Number(row[13]) },
      ],
      rekomendasi: row[14],
    };
  });

  return ContentService.createTextOutput(JSON.stringify({ result: 'success', data: soalList }))
                       .setMimeType(ContentService.MimeType.JSON);
}

function handleUpdateSoal(e) {
  if (!isAdminPasswordValid(e.parameter.password)) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Akses ditolak.' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  var no = Number(e.parameter.no);
  if (!no) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Nomor soal tidak valid.' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  var dimensi = (e.parameter.dimensi || '').trim();
  var pertanyaan = (e.parameter.pertanyaan || '').trim();
  var rekomendasi = (e.parameter.rekomendasi || '').trim();

  if (!dimensi || !pertanyaan || !rekomendasi) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Dimensi, pertanyaan, dan rekomendasi wajib diisi.' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  var opsiFields = [];
  var keys = ['a', 'b', 'c', 'd', 'e'];
  for (var i = 0; i < keys.length; i++) {
    var teks = (e.parameter['opsi' + keys[i]] || '').trim();
    var skor = Number(e.parameter['skor' + keys[i]]);

    if (!teks) {
      return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Opsi ' + keys[i].toUpperCase() + ' tidak boleh kosong.' }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    if (!skor || skor < 1 || skor > 5 || isNaN(skor)) {
      return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Skor opsi ' + keys[i].toUpperCase() + ' harus angka 1-5.' }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    opsiFields.push(teks, skor);
  }

  var sheet = getSheetBankSoal();
  var lastRow = sheet.getLastRow();
  var noCol = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  var targetRowIndex = -1;
  for (var r = 0; r < noCol.length; r++) {
    if (Number(noCol[r][0]) === no) {
      targetRowIndex = r + 2;
      break;
    }
  }

  if (targetRowIndex === -1) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Soal nomor ' + no + ' tidak ditemukan.' }))
                         .setMimeType(ContentService.MimeType.JSON);
  }

  // kolom Marker (kolom 2) TIDAK diubah — tetap terkunci ke marker fisik aslinya
  var newRow = [no, sheet.getRange(targetRowIndex, 2).getValue(), dimensi, pertanyaan].concat(opsiFields).concat([rekomendasi]);
  sheet.getRange(targetRowIndex, 1, 1, newRow.length).setValues([newRow]);

  return ContentService.createTextOutput(JSON.stringify({ result: 'success' }))
                       .setMimeType(ContentService.MimeType.JSON);
}

// ================= REKOMENDASI HASIL ASESMEN (AI-generated, 1x panggilan untuk semua soal) =================
function handleGenerateRekomendasi(e) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return ContentService.createTextOutput(JSON.stringify({
        result: 'error',
        message: 'GEMINI_API_KEY belum diset di Script Properties.'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var dataSoalJawaban;
    try {
      dataSoalJawaban = JSON.parse(e.parameter.dataSoalJawaban || '[]');
    } catch (parseErr) {
      return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Format data tidak valid.' }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    if (!dataSoalJawaban.length) {
      return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Tidak ada data soal.' }))
                           .setMimeType(ContentService.MimeType.JSON);
    }

    var systemInstruction =
      'Kamu adalah asisten AI yang menganalisis hasil evaluasi siswa pada platform SiapLulus, ' +
      'sebuah media pembelajaran delapan dimensi Profil Lulusan. Kamu akan menerima daftar butir ' +
      'soal beserta jawaban dan skor (1-5) yang dipilih siswa. Untuk SETIAP butir, berikan SATU ' +
      'rekomendasi singkat (1-2 kalimat, bahasa Indonesia, nada suportif dan membangun, bukan ' +
      'menghakimi) yang relevan dengan ISI pertanyaan dan pilihan jawaban yang dipilih siswa — ' +
      'bukan kalimat generik/template. Jika skor tinggi (4-5), apresiasi sikap tersebut secara ' +
      'spesifik dan dorong untuk konsisten. Jika skor rendah (1-3), beri saran konkret dan ' +
      'spesifik terkait situasi pada soal tersebut, bukan nasihat umum. ' +
      'WAJIB jawab HANYA dalam format JSON array of string, tanpa teks lain, tanpa markdown code ' +
      'fence, dengan jumlah elemen PERSIS sama dengan jumlah butir yang diberikan, urut sesuai ' +
      'urutan input. Contoh format: ["rekomendasi butir 1", "rekomendasi butir 2", ...]';

    var daftarButir = dataSoalJawaban.map(function (item, idx) {
      return (idx + 1) + '. Dimensi: ' + item.dimensi + '\n   Soal: ' + item.soal +
             '\n   Jawaban siswa: ' + item.jawabanText + '\n   Skor: ' + item.skor + '/5';
    }).join('\n\n');

    var payload = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{ parts: [{ text: 'Berikut daftar butir soal, jawaban, dan skor siswa:\n\n' + daftarButir }] }],
      generationConfig: { responseMimeType: 'application/json' },
    };

    var json = null;
    var percobaanTerakhirError = null;

    for (var percobaan = 1; percobaan <= 3; percobaan++) {
      var response = UrlFetchApp.fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',
        {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-goog-api-key': apiKey },
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        }
      );

      json = JSON.parse(response.getContentText());

      if (!json.error) {
        percobaanTerakhirError = null;
        break;
      }

      percobaanTerakhirError = json.error;
      var pesanError = (json.error.message || '').toLowerCase();
      var perluRetry = pesanError.indexOf('high demand') !== -1 ||
                        pesanError.indexOf('overloaded') !== -1 ||
                        pesanError.indexOf('unavailable') !== -1 ||
                        pesanError.indexOf('try again') !== -1;

      if (!perluRetry || percobaan === 3) {
        break;
      }

      Utilities.sleep(percobaan * 1500);
    }

    if (percobaanTerakhirError) {
      return ContentService.createTextOutput(JSON.stringify({
        result: 'error',
        message: 'Error Gemini API: ' + percobaanTerakhirError.message + ' (sudah dicoba 3x)'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var teksJson = json.candidates && json.candidates[0] && json.candidates[0].content
      ? json.candidates[0].content.parts[0].text
      : '[]';

    var rekomendasiArray;
    try {
      rekomendasiArray = JSON.parse(teksJson);
    } catch (parseErr2) {
      var bersih = teksJson.replace(/```json/g, '').replace(/```/g, '').trim();
      try {
        rekomendasiArray = JSON.parse(bersih);
      } catch (parseErr3) {
        return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: 'Gagal membaca respons AI.' }))
                             .setMimeType(ContentService.MimeType.JSON);
      }
    }

    while (rekomendasiArray.length < dataSoalJawaban.length) {
      rekomendasiArray.push('Rekomendasi tidak tersedia untuk butir ini.');
    }

    return ContentService.createTextOutput(JSON.stringify({ result: 'success', rekomendasi: rekomendasiArray }))
                         .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', message: error.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}
