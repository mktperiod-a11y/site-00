(function () {
  var btn = document.querySelector('.menu-btn');
  var nav = document.getElementById('site-nav');

  if (btn && nav) {
    var label = btn.querySelector('.menu-label');
    var setOpen = function (open) {
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (label) label.textContent = open ? '닫기' : '메뉴';
    };
    btn.addEventListener('click', function (event) {
      event.stopPropagation();
      setOpen(!nav.classList.contains('is-open'));
    });
    document.addEventListener('click', function (event) {
      if (nav.classList.contains('is-open') && !nav.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    }, true);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        setOpen(false);
        btn.focus();
      }
    });
  }

  var stamp = document.querySelector('[data-updated]');
  if (stamp) {
    var parts = stamp.getAttribute('data-updated').split('-');
    var then = Date.UTC(+parts[0], +parts[1] - 1, +parts[2]);
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    var days = Math.round((today - then) / 86400000);
    if (days >= 0 && days < 60) stamp.textContent = days === 0 ? ' · 오늘 갱신' : ' · ' + days + '일 전 갱신';
  }
})();
