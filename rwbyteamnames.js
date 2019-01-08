var initials = ["R","B","Y","U"];
var requestURL = 'https://raw.githubusercontent.com/Nightcrab/RWBY-Team-Name-Generator/master/colours.json';
var request = new XMLHttpRequest();
request.open('GET', requestURL);
request.responseType = 'json';
request.send();
var o_colours;
request.onload = function() {
	console.log(request.response);
	o_colours = request.response.colours;
	console.log('colours recieved : '+o_colours[0]);
}

String.prototype.splice = function (index, count, add) {
  if (index < 0) {
    index = this.length + index;
    if (index < 0) {
      index = 0;
    }
  }
  return this.slice(0, index) + (add || "") + this.slice(index + count);
}

function genNames () {
		let initials = [];
		let names = "";
		let colours = o_colours.slice(0);
		let x = document.getElementById("form1");
		for (i = 0; i < x.length ;i++) {
			initials.push(x.elements[i].value.charAt(0));
		}
		console.log(x);

		colours = colours.map(c => c.toLowerCase());
		initials = initials.map(i => i.toLowerCase());

		colours = colours.filter(c => {for (n=0;n<0;n++){c = c.splice(c.indexOf(initials[n]), 1);} return c.indexOf(initials[0]) !== -1;});
		console.log(colours);
		colours = colours.filter(c => {for (n=0;n<1;n++){c = c.splice(c.indexOf(initials[n]), 1);} return c.indexOf(initials[1]) !== -1;});
		console.log(colours);
		colours = colours.filter(c => {for (n=0;n<2;n++){c = c.splice(c.indexOf(initials[n]), 1);} return c.indexOf(initials[2]) !== -1;});
		console.log(colours);
		colours = colours.filter(c => {for (n=0;n<3;n++){c = c.splice(c.indexOf(initials[n]), 1);} return c.indexOf(initials[3]) !== -1;});


		function locations (string, substring) {
			let a = [], i = -1;
			while((i = string.indexOf(substring,i+1)) >= 0) a.push(i);
			return a;
		}
		for (i=0;i<colours.length;i++) {
			let teamname = colours[i] + " : "; //harvest gold
			let _initials = initials.slice(0);
			indxs = [
					colours[i].indexOf(initials[0]), //s 6
					colours[i].indexOf(initials[1]), //r 2
					colours[i].indexOf(initials[2]), //l 10
					colours[i].indexOf(initials[3])	//v 3
				];
				indxs.sort((a, b) => a - b); // 2, 3, 6, 10
				teamname += (colours[i].charAt(indxs[0])
							 + colours[i].charAt(indxs[1])
							 + colours[i].charAt(indxs[2])
							 + colours[i].charAt(indxs[3]) + ", ").toUpperCase();
			names += teamname+"<br>";
		}

		document.getElementById("results").innerHTML = names;
	}