# Safe-Route-Crime-Map_V2
A proof of concept for a map where citizens can safely navigate high-crime neighbourhoods through the safest possible route, by fetching real time crime statistics. 

Setup Instructions for anyone to run the program locally:

Install Node.js
Download from nodejs.org Get the LTS (Long Term Support) version Install it

Create Project Folder bashmkdir saferoute-app cd saferoute-app

Set Up Files

Put 'server.js` in the main folder
Create a folder called public
Put index.html and app.js inside the public folder
Your folder structure should look like:

saferoute-app/

├── server.js

├── public/

│ ├── index.html

│ └── app.js

└── package.json (will be created automatically)

Install Dependencies Open terminal/command prompt in the project folder and run: npm init -y and then enter: npm install express axios cors

Run the Server node server.js

You should see:

Server running on http://localhost:5000

Serving files from: [...]\public

Open http://localhost:5000 in your browser

Open in Browser Go to: http://localhost:5000 The website should work perfectly!
