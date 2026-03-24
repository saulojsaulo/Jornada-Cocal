const start = "2026-03-01";
const end = "2026-03-24";
const current = new Date(start + "T00:00:00");
const endDate = new Date(end + "T23:59:59");
const days = [];
while (current <= endDate) {
  const d = new Date(current);
  days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  current.setDate(current.getDate() + 1);
}
console.log(days[days.length - 1]);
console.log(days.length);
