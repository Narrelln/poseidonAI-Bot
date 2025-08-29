document.addEventListener("DOMContentLoaded", () => {
    enhanceOpenPositionsTable();
    setInterval(updatePositionAges, 1000);
  });
  
  const positionNotes = {}; // Stores notes by contract
  const positionTimestamps = {}; // Stores open time per contract
  
  function enhanceOpenPositionsTable() {
    const table = document.querySelector(".open-positions-table");
    if (!table) return;
  
    const body = table.querySelector("tbody");
    if (!body) return;
  
    [...body.rows].forEach(row => {
      const symbolCell = row.cells[0];
      if (!symbolCell || row.classList.contains("dimmed")) return;
  
      const contract = symbolCell.textContent.trim();
  
      // Only inject if not already injected
      if (!row.querySelector(".position-note-input")) {
        // Notes column
        const notesCell = row.insertCell(-1);
        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Add note...";
        input.value = positionNotes[contract] || "";
        input.classList.add("position-note-input");
  
        input.addEventListener("input", () => {
          positionNotes[contract] = input.value;
        });
  
        notesCell.appendChild(input);
      }
  
      // Age column
      if (!row.querySelector(".position-age")) {
        const ageCell = row.insertCell(-1);
        ageCell.classList.add("position-age");
        ageCell.setAttribute("data-contract", contract);
  
        if (!positionTimestamps[contract]) {
          positionTimestamps[contract] = Date.now();
        }
      }
    });
  }
  
  function updatePositionAges() {
    const ageCells = document.querySelectorAll(".position-age");
  
    ageCells.forEach(cell => {
      const contract = cell.getAttribute("data-contract");
      const openTime = positionTimestamps[contract];
      if (!openTime) return;
  
      const secondsElapsed = Math.floor((Date.now() - openTime) / 1000);
      cell.textContent = formatDuration(secondsElapsed);
    });
  }
  
  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }