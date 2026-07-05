/*
 * lang.js — tiny i18n for menus/lobby (English + Arabic/RTL).
 * Not a full framework: just a string table + a helper that walks the DOM
 * applying data-i18n="key" text and flips <html dir> for RTL layout.
 */
(function (global) {
  'use strict';

  var STRINGS = {
    en: {
      title: 'ZIZO HIDE',
      tagline: 'Paint. Blend in. Survive.',
      nickname_label: 'Nickname',
      nickname_placeholder: 'Enter your nickname',
      public_rooms: 'Public Rooms',
      refresh: 'Refresh',
      no_rooms: 'No open public rooms right now — create one!',
      create_public: 'Create Public Room',
      create_private: 'Create Private Room',
      join_code: 'Join by Code',
      join_code_placeholder: 'Room code',
      join: 'Join',
      players: 'Players',
      map: 'Map',
      seekers: 'Seekers',
      paint_time: 'Painting Time (sec)',
      round_time: 'Round Time (sec)',
      repaint_limit: 'Repaint Limit',
      ready: 'Ready',
      not_ready: 'Not Ready',
      start_round: 'Start Round',
      waiting_for_host: 'Waiting for host to start...',
      lobby: 'Lobby',
      role_hider: 'Hider',
      role_seeker: 'Seeker',
      spectate: 'Spectate',
      leave: 'Leave',
      language: 'العربية'
    },
    ar: {
      title: 'زيزو الاختباء',
      tagline: 'اطلِ. اندمج. انجُ بنفسك.',
      nickname_label: 'الاسم المستعار',
      nickname_placeholder: 'أدخل اسمك المستعار',
      public_rooms: 'غرف عامة',
      refresh: 'تحديث',
      no_rooms: 'لا توجد غرف عامة مفتوحة حالياً — أنشئ واحدة!',
      create_public: 'إنشاء غرفة عامة',
      create_private: 'إنشاء غرفة خاصة',
      join_code: 'الانضمام برمز',
      join_code_placeholder: 'رمز الغرفة',
      join: 'انضمام',
      players: 'اللاعبون',
      map: 'الخريطة',
      seekers: 'الباحثون',
      paint_time: 'وقت الطلاء (ثانية)',
      round_time: 'وقت الجولة (ثانية)',
      repaint_limit: 'عدد مرات إعادة الطلاء',
      ready: 'جاهز',
      not_ready: 'غير جاهز',
      start_round: 'ابدأ الجولة',
      waiting_for_host: 'بانتظار المضيف لبدء اللعبة...',
      lobby: 'غرفة الانتظار',
      role_hider: 'مختبئ',
      role_seeker: 'باحث',
      spectate: 'مشاهدة',
      leave: 'مغادرة',
      language: 'English'
    }
  };

  function getLang() {
    return localStorage.getItem('zizo_lang') || 'en';
  }

  function setLang(lang) {
    localStorage.setItem('zizo_lang', lang);
    apply(lang);
  }

  function t(key) {
    var lang = getLang();
    return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
  }

  function apply(lang) {
    lang = lang || getLang();
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      var key = node.getAttribute('data-i18n');
      node.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (node) {
      var key = node.getAttribute('data-i18n-placeholder');
      node.setAttribute('placeholder', t(key));
    });
  }

  global.ZizoLang = { t: t, getLang: getLang, setLang: setLang, apply: apply };
})(window);
