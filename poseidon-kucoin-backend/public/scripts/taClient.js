// /public/scripts/taClient.js

export async function fetchTA(symbol) {
    const res = await fetch(`/api/ta/${symbol}`);
    const data = await res.json();
    return data;
  }