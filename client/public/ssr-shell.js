/* Progressive enhancement for server-rendered public documents.
   Footer groups ship as <details open> so every link is readable and crawlable without JavaScript.
   Below 1024px this collapses them into accordions; from 1024px they stay expanded. */
(function () {
  var query = window.matchMedia("(min-width:1024px)");
  function sync() {
    var groups = document.querySelectorAll(".ssr-footer-group");
    for (var i = 0; i < groups.length; i++) groups[i].open = query.matches;
  }
  sync();
  if (query.addEventListener) query.addEventListener("change", sync);
})();
