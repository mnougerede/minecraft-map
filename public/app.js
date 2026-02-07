const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

ctx.fillStyle = "black";
ctx.fillRect(0, 0, canvas.width, canvas.height);

ctx.fillStyle = "red";
ctx.beginPath();
ctx.arc(400, 300, 5, 0, Math.PI * 2);
ctx.fill();
