var Diaporama = require("diaporama");

document.body.style.background = "#000";
document.body.style.margin = "0";
document.body.style.overflow = "hidden";

var div = document.createElement("div");
div.style.width = window.innerWidth + "px";
div.style.height = window.innerHeight + "px";
document.body.appendChild(div);

var diaporama = Diaporama(div, {
  GlslTransitions: require("glsl-transitions"),
  data: require("./diaporama.json"),
  autoplay: true,
  loop: true
});

window.addEventListener("resize", function () {
  diaporama.width = window.innerWidth;
  diaporama.height = window.innerHeight;
});

document.body.addEventListener("keydown", function (e) {
  switch (e.which) {
    case 38: // Up
      diaporama.playbackRate *= 1.5;
      break;
    case 40: // Down
      diaporama.playbackRate /= 1.5;
      break;
    case 37: // Left
      diaporama.prev();
      break;
    case 39: // Right
      diaporama.next();
      break;
    case 32: // Space
      diaporama.paused = !diaporama.paused;
      break;
  }
});

