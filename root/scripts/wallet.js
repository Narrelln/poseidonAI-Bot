console.log("wallet.js loaded");

// Fake wallet stats injection
setTimeout(() => {
  document.getElementById("whale-wallets").textContent = "29";
  document.getElementById("insiders").textContent = "7";
  document.getElementById("top-wallet").textContent = "Groovy";

  const walletLog = document.getElementById("wallet-log");
  walletLog.innerHTML = `
    <div class="feed-log-entry">🐋 Wallet ABC123 bought $MOON at 12K MC</div>
    <div class="feed-log-entry">🔍 Wallet JAKE999 sniped $ZEBRA before bonding</div>
    <div class="feed-log-entry">🔥 Whale 6F8E... started DCA on $SWORD</div>
    <div class="feed-log-entry">💡 Insider ELLA detected early in $ORB launch</div>
  `;
}, 1000);