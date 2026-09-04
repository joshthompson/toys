import { For, Show } from 'solid-js';
import { affordable, moneys, type Panes } from '../os/shell';

/**
 * Josh's Bank — the money side of a computer that is otherwise all pictures and sums.
 *
 * There is nothing clever here on purpose. A balance, what has come out of it, and
 * anything an app is currently asking for. The whole point of it is to be the plain,
 * official looking place where the maths app's demands turn up in writing.
 *
 * There is no way to pay in. The balance goes one way, which is down, and the only
 * decision anybody gets is whether to let it go down again — and not even that, once
 * what is being asked for is more than what is there. The account stops at nothing.
 */

/** The account it is all kept in, which is not a real one anywhere. */
const ACCOUNT = 'IE00 BANK 0000 0000 0001';

/** '26 Aug, 14:03' — the day and the minute, which is what a statement shows. */
const stamped = (at: number) => {
  const when = new Date(at);
  const day = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
};

export function BankPane(props: { panes: Panes }) {
  const ledger = () => props.panes.bank.transactions();
  /** Newest first, the way every statement anybody has ever read is ordered. */
  const recent = () => [...ledger()].reverse();
  const balance = () => props.panes.bank.balance();
  const asking = () => props.panes.bank.pending();
  /** Whether there is the money for what is being asked for, which is the whole rule. */
  const affords = (amount: number) => affordable(balance(), amount);

  return (
    <div class="bank-pane">
      <header class="bank-header">
        <p class="bank-account">Current Account</p>
        <p class="bank-number">{ACCOUNT}</p>
        {/* Overdrawn is shown in the red every bank shows it in. */}
        <p class="bank-balance" classList={{ 'is-short': balance() < 0 }}>
          {moneys(balance())}
        </p>
        <p class="bank-since">Available balance</p>
      </header>

      {/* An app is after money. Nothing moves until this is answered one way or another. */}
      <Show when={asking()}>
        {(charge) => (
          <div class="bank-ask">
            <p class="bank-ask-head">Approve this payment?</p>
            <p class="bank-ask-what">
              <strong>{charge().from}</strong>
              <span class="bank-ask-for">{charge().what}</span>
            </p>
            <p class="bank-ask-amount">{moneys(charge().amount)}</p>
            {/* Said before the button is reached for rather than after, since a bank
                that lets you press Approve and then says no is a worse bank. */}
            <Show when={!affords(charge().amount)}>
              <p class="bank-ask-short">
                There is {moneys(balance())} in the account. This one cannot be
                approved, and declining it is the whole of what is on offer.
              </p>
            </Show>
            <p class="bank-ask-buttons">
              <button
                class="chrome-button"
                aria-disabled={!affords(charge().amount)}
                onClick={() => affords(charge().amount) && props.panes.bank.approve()}
              >
                Approve
              </button>
              <button class="chrome-button" onClick={() => props.panes.bank.decline()}>
                Decline
              </button>
            </p>
          </div>
        )}
      </Show>

      <div class="bank-log">
        <Show
          when={recent().length}
          fallback={
            <p class="bank-empty">
              No transactions. There is nothing in this account and nothing has ever
              happened to it, which is the best it will ever look.
            </p>
          }
        >
          <For each={recent()}>
            {(entry) => (
              <p class="bank-entry">
                {/* Who took it, then what they said it was for and when — the way a
                    statement names the shop before it names the sandwich. An entry from
                    before the bank kept track of that leads with what it was for. */}
                <span class="bank-what">{entry.from ?? entry.what}</span>
                <span class="bank-when">
                  <Show when={entry.from}>{entry.what} · </Show>
                  {stamped(entry.at)}
                </span>
                <span class="bank-amount" classList={{ 'is-out': entry.amount < 0 }}>
                  {entry.amount > 0 ? '+' : ''}
                  {moneys(entry.amount)}
                </span>
              </p>
            )}
          </For>
        </Show>
      </div>

      <footer class="bank-bar">
        <span class="bank-note">
          {ledger().length === 1 ? '1 transaction' : `${ledger().length} transactions`}
        </span>
        {/* Said plainly, so that looking for the button to add money is a short search. */}
        <span class="bank-note">No deposits accepted.</span>
      </footer>
    </div>
  );
}
