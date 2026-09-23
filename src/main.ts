import { Game, enableKiosk } from './game/Game';
import './style.css';

async function main(): Promise<void> {
  const host = document.querySelector<HTMLDivElement>('#app');
  if (!host) throw new Error('#app missing');

  const game = new Game();
  await game.start(host);
  enableKiosk(host, game);
}

main().catch((err) => {
  console.error(err);
  const host = document.querySelector('#app');
  if (host) host.textContent = String(err);
});
