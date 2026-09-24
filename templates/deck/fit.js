// A slide written slightly too full is scaled down to fit instead of spilling over its own header
// and footer. The canvas is fixed and the words are not, so this is the direction to bend: a
// smaller slide still reads, a slide whose last line is under the footer does not.
(function () {
  function fit(slide) {
    var main = slide.querySelector('main');
    var box = slide.querySelector('.content');
    if (!main || !box) return;
    // `clientHeight` includes the padding, and the padding is not somewhere text may go.
    var style = window.getComputedStyle(main);
    var room = main.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    var need = box.offsetHeight;
    if (room > 0 && need > room) box.style.zoom = Math.max(0.5, room / need).toFixed(3);
  }
  var slides = document.querySelectorAll('.slide');
  for (var i = 0; i < slides.length; i += 1) fit(slides[i]);
})();
