
// scripts/openPositions.js

const positionNotes = {}; // Stores notes per contract
const positionTimestamps = {}; // Stores timestamps per contract

async function loadOpenPositions() {
  try {
    const res = await fetch('/api/positions');
    const data = await res.json();
    const container = document.getElementById('open-positions-body');
    container.innerHTML = '';

    if (!data.success || !data.positions || data.positions.length === 0) {
      container.innerHTML = `<tr><td colspan="13" class="dimmed">No open positions</td></tr>`;
      return;
    }

    data.positions.forEach(pos => {
      const row = document.createElement('tr');

      const entry = parseFloat(pos.entryPrice || 0);
      const mark = parseFloat(pos.markPrice || entry);
      const size = Math.abs(parseFloat(pos.size || pos.quantity || 0));
      const value = entry * size;
      const leverage = parseFloat(pos.leverage || 1);
      const margin = parseFloat(pos.margin) || (value / leverage);  // ✅ FIXED

      const isLong = pos.side?.toLowerCase() === 'buy' || pos.quantity > 0;
      const pnlValue = isLong ? (mark - entry) * size : (entry - mark) * size;
      const roi = value > 0 ? (((pnlValue / value) * 100).toFixed(2)) : '0.00';

      const pnlColor = pnlValue > 0 ? 'lime' : (pnlValue < 0 ? 'red' : 'yellow');
      const roiColor = roi.includes('-') ? 'red' : (parseFloat(roi) > 0 ? 'lime' : 'gray');

      const contract = pos.contract;

      if (!positionTimestamps[contract]) {
        positionTimestamps[contract] = Date.now();
      }

      const noteInput = document.createElement('input');
      noteInput.type = 'text';
      noteInput.placeholder = 'Add note...';
      noteInput.value = positionNotes[contract] || '';
      noteInput.classList.add('position-note-input');
      noteInput.addEventListener('input', () => {
        positionNotes[contract] = noteInput.value;
      });

      const ageSpan = document.createElement('span');
      ageSpan.classList.add('position-age');
      ageSpan.setAttribute('data-contract', contract);

      row.innerHTML = `
        <td>${pos.symbol}</td>
        <td class="${isLong ? 'long' : 'short'}">${isLong ? 'LONG' : 'SHORT'}</td>
        <td>${entry.toFixed(4)}</td>
        <td>${size}</td>
        <td>${value.toFixed(2)}</td>
        <td>${margin.toFixed(2)}</td>
        <td style="color:${pnlColor};">${pnlValue.toFixed(2)}</td>
        <td style="color:${roiColor};">${roi}%</td>
        <td>${leverage.toFixed(2)}x</td>
        <td>${pos.liquidation || '-'}</td>
        <td>
          <button class="close-btn" data-contract="${contract}" data-side="${isLong ? 'long' : 'short'}">✖</button>
        </td>
      `;

      const notesCell = document.createElement('td');
      notesCell.appendChild(noteInput);

      const ageCell = document.createElement('td');
      ageCell.appendChild(ageSpan);

      row.appendChild(notesCell);
      row.appendChild(ageCell);

      container.appendChild(row);
    });

    document.querySelectorAll('.close-btn').forEach(button => {
      button.addEventListener('click', async () => {
        const contract = button.getAttribute('data-contract');
        const side = button.getAttribute('data-side');
        await closePosition(contract, side);
      });
    });
  } catch (err) {
    console.error('❌ Error loading open positions:', err.message);
  }
}

function updatePositionAges() {
  const now = Date.now();
  const ageCells = document.querySelectorAll('.position-age');

  ageCells.forEach(cell => {
    const contract = cell.getAttribute('data-contract');
    const openTime = positionTimestamps[contract];
    if (!openTime) return;

    const secondsElapsed = Math.floor((now - openTime) / 1000);
    cell.textContent = formatDuration(secondsElapsed);
  });
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

async function closePosition(contract, side) {
  const button = document.querySelector(`button[data-contract="${contract}"]`);
  if (button) button.disabled = true;

  try {
    const res = await fetch('/api/close-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contract, side })
    });
    const result = await res.json();
    if (result.success) {
      delete positionTimestamps[contract];
      delete positionNotes[contract];
      await loadOpenPositions();
    } else {
      alert("❌ Close failed: " + (result.error || "Unknown error"));
    }
  } catch (err) {
    alert("❌ Close error: " + err.message);
  } finally {
    if (button) button.disabled = false;
  }
}

setInterval(loadOpenPositions, 10000);
setInterval(updatePositionAges, 1000);
document.addEventListener('DOMContentLoaded', loadOpenPositions);


function updateLivePnL() {
  const rows = document.querySelectorAll('#open-positions-body tr');
  rows.forEach(row => {
    const contract = row.querySelector('button.close-btn')?.getAttribute('data-contract');
    const side = row.querySelector('button.close-btn')?.getAttribute('data-side');
    if (!contract || !side) return;

    fetch(`/api/futures-price/${contract}`)
      .then(res => res.json())
      .then(data => {
        const mark = parseFloat(data?.price);
        if (!mark || isNaN(mark)) return;

        const entry = parseFloat(row.children[2].textContent);
        const size = parseFloat(row.children[3].textContent);
        const value = entry * size;
        const isLong = side === 'long';
        const pnl = isLong ? (mark - entry) * size : (entry - mark) * size;
        const roi = value > 0 ? ((pnl / value) * 100).toFixed(2) : '0.00';

        const pnlCell = row.children[6];
        const roiCell = row.children[7];
        pnlCell.textContent = pnl.toFixed(2);
        pnlCell.style.color = pnl > 0 ? 'lime' : (pnl < 0 ? 'red' : 'yellow');

        roiCell.textContent = roi + '%';
        roiCell.style.color = roi.includes('-') ? 'red' : (parseFloat(roi) > 0 ? 'lime' : 'gray');
      });
  });
}
setInterval(updateLivePnL, 1000);

export { loadOpenPositions };
