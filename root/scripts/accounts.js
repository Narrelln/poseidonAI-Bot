document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("balance").textContent = "Balance: 12.4 SOL";
  document.getElementById("capital-usage").textContent = "Capital in Use: 3.2 SOL";
  document.getElementById("win-loss").textContent = "Win Rate: 67%";

  const txTable = document.getElementById("tx-table").querySelector("tbody");

  // Sample static data for now
  const transactions = [
    { date: "2025-06-21", token: "$DOGEY", side: "Long", amount: "0.2 SOL", result: "+35%" },
    { date: "2025-06-20", token: "$ZOOM", side: "Short", amount: "0.1 SOL", result: "-10%" }
  ];

  transactions.forEach(tx => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${tx.date}</td>
      <td>${tx.token}</td>
      <td>${tx.side}</td>
      <td>${tx.amount}</td>
      <td>${tx.result}</td>
    `;
    txTable.appendChild(row);
  });
}); // ✅ This closing brace was missing