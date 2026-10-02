/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2026 Spacebar and Spacebar Contributors
	
	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.
	
	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// Minor port of https://github.com/TheArcaneBrony/ArcaneLibs/blob/master/ArcaneLibs/ConsoleUtils.cs
import { RgbValue } from "./ColorUtils";

export class ConsoleUtils {
    public static ColorSequence(rgb: RgbValue) {
        return rgb.asAnsiEscapeSequence();
    }
    public static SetConsoleColor(rgb: RgbValue) {
        console.log(rgb.asAnsiEscapeSequence());
    }
    public static ColoredString(text: string, rgb: RgbValue) {
        return rgb.asAnsiEscapeSequence() + text + "\x1b[0m";
    }
}
