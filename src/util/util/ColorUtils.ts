/*
	Spacebar: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Spacebar and Spacebar Contributors
	
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

export class RgbValue {
    r: number;
    g: number;
    b: number;
    constructor(r: number, g: number, b: number) {
        this.r = r;
        this.g = g;
        this.b = b;
    }

    public asHex(withSigil: boolean = true) {
        return `${withSigil ? "#" : ""}${this.r.toString(16).toUpperCase()}${this.g.toString(16).toUpperCase()}${this.b.toString(16).toUpperCase()}`;
    }

    public asAnsiEscapeSequence() {
        return `\x1b[38;2;${this.r};${this.g};${this.b}m`;
    }
}

export class ColorUtils {
    public static cnv8To24(val: number): RgbValue {
        return new RgbValue((val >> 5) * 32, ((val & 28) >> 2) * 32, (val & 3) * 64);
    }
}
