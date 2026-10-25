(() => {
  const page = document.body.dataset.page || 'monthly';
  const config = {
    monthly: { title: 'Monthly budget', subtitle: 'Plan your month, set a daily limit, and track every expense.' },
    period: { title: 'Specific period budget', subtitle: 'Choose a date range and track daily spending against one total target.' },
    plans: { title: 'Future plans', subtitle: 'Build toward your savings goals one contribution at a time.' },
    transactions: { title: 'Transactions', subtitle: 'Review, filter, export, or remove recorded expenses.' },
    'other-money': { title: 'Other money', subtitle: 'Keep separate records of money received, given, or set aside.' }
  };
  const item = config[page] || config.monthly;
  document.title = `${item.title} — Pocket`;
  const heading = document.querySelector('.topbar h1');
  const subtitle = document.querySelector('.topbar .subheading');
  if (heading) heading.textContent = item.title;
  if (subtitle) subtitle.textContent = item.subtitle;
  document.querySelectorAll('.nav-item[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === page));
  const mode = document.getElementById('daily-target-mode');
  if (mode) {
    const todayOption = mode.querySelector('option[value="today"]');
    const periodOption = mode.querySelector('option[value="period"]');
    if (page === 'period') { if (todayOption) todayOption.hidden = true; mode.value = 'period'; }
    else { if (periodOption) periodOption.hidden = true; mode.value = 'today'; }
    mode.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const label = document.querySelector('label[for="daily-target-amount"]');
  if (label) label.textContent = page === 'period' ? 'Total budget for this period (₹)' : 'Daily spending limit (₹)';
  const note = document.querySelector('#daily-target-form .field label[for="daily-target-note"]');
  if (note) note.textContent = page === 'period' ? 'Period label (optional)' : 'Label (optional)';
  const intro = document.querySelector('.daily-targets .monthly-funds-heading p');
  if (intro) intro.textContent = page === 'period' ? 'Set one total amount for a date range. The tracker shows each day’s spending and a suggested daily allowance based on what remains.' : 'Set your daily spending limit for the selected date. The tracker shows today’s spending and how much is left.';
})();
