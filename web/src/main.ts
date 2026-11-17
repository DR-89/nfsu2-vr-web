// The player-facing page (web/index.html): the start screen and the game.
import './app/started';
import './app/style.css';
import { boot } from './app/shell';
import {prepareNativeHaptics} from './vr/native-haptics';

prepareNativeHaptics();
void boot();
