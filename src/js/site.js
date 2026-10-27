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
})();
