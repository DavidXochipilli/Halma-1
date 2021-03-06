// Code adapted from the guide at
// http://buildnewgames.com/real-time-multiplayer


var game_server = module.exports = {games: {}, game_count: 0};
var UUID = require('node-uuid');
var verbose = true;

global.window = global.document = global;

//Import shared game library code.
require('./game.core.js');

//A simple wrapper for logging so we can toggle it,
//and augment it for clarity.
game_server.log = function () {
    if (verbose) console.log.apply(this, arguments);
};

game_server._dt = new Date().getTime();
game_server._dte = new Date().getTime();

//a local queue of messages we delay if faking latency
game_server.messages = [];

setInterval(function () {
    game_server._dt = new Date().getTime() - game_server._dte;
    game_server._dte = new Date().getTime();
    game_server.local_time += game_server._dt / 1000.0;
}, 4);

game_server.onMessage = function (client, message) {

    if (this.fake_latency && message.split('.')[0].substr(0, 1) == 'i') {

        //store all input message
        game_server.messages.push({client: client, message: message});

        setTimeout(function () {
            if (game_server.messages.length) {
                game_server._onMessage(game_server.messages[0].client, game_server.messages[0].message);
                game_server.messages.splice(0, 1);
            }
        }.bind(this), this.fake_latency);

    } else {
        game_server._onMessage(client, message);
    }
};

game_server._onMessage = function (client, message) {

    //Cut the message up into sub components
    var message_parts = message.split('.');
    //The first is always the type of message
    var message_type = message_parts[0];

    var other_client =
        (client.game.player_host.userid == client.userid) ?
            client.game.player_client : client.game.player_host;


    // Player made a move,
    // Relay the move to the other client
    if (message_type == 'z') {
        if (other_client) {
            other_client.send(message);
        }
    } else if (message_type == 't') {
        if (other_client) {
            other_client.send(message);
        }
    } else if (message_type == 'p') {
        client.send('s.p.' + message_parts[1]);
    }
};

//Define some required functions
game_server.createGame = function (player) {

    //Create a new game instance
    var thegame = {
        id: UUID(),                //generate a new id for the game
        player_host: player,         //so we know who initiated the game
        player_client: null,         //nobody else joined yet, since its new
        player_count: 1              //for simple checking of state
    };

    //Store it in the list of game
    this.games[thegame.id] = thegame;

    //Keep track
    this.game_count++;

    //Create a new game core instance, this actually runs the
    //game code like collisions and such.
    thegame.gamecore = new game_core(thegame);
    //Start updating the game loop on the server
    thegame.gamecore.update(new Date().getTime());

    //tell the player that they are now the host
    //s=server message, h=you are hosting

    player.send('s.h.' + String(thegame.gamecore.local_time).replace('.', '-'));
    console.log('server host at  ' + thegame.gamecore.local_time);
    player.game = thegame;
    player.hosting = true;

    this.log('[HALMA] Player Created Game: PlayerId: ' + player.userid + '  GameId:' + player.game.id);

    return thegame;

};

//we are requesting to kill a game in progress.
game_server.endGame = function (gameid, userid) {

    var thegame = this.games[gameid];

    if (thegame) {

        //stop the game updates immediate
        thegame.gamecore.stop_update();

        //if the game has two players, the one is leaving
        if (thegame.player_count > 1) {

            //send the players the message the game is ending
            if (userid == thegame.player_host.userid) {

                //the host left, oh snap. Lets try join another game
                if (thegame.player_client) {
                    //tell them the game is over
                    thegame.player_client.send('s.e');
                    //now look for/create a new game.
                    this.findGame(thegame.player_client);
                }

            } else {
                //the other player left, we were hosting
                if (thegame.player_host) {
                    //tell the client the game is ended
                    thegame.player_host.send('s.e');
                    //i am no longer hosting, this game is going down
                    thegame.player_host.hosting = false;
                    //now look for/create a new game.
                    this.findGame(thegame.player_host);
                }
            }
        }

        delete this.games[gameid];
        this.game_count--;

        this.log('[HALMA] Game Removed. There are now ' + this.game_count + ' games');

    } else {
        this.log('[HALMA] Game Not Found.');
    }

};

game_server.startGame = function (game) {

    //right so a game has 2 players and wants to begin
    //the host already knows they are hosting,
    //tell the other client they are joining a game
    //s=server message, j=you are joining, send them the host id
    game.player_client.send('s.j.' + game.player_host.userid);
    game.player_client.game = game;

    //now we tell both that the game is ready to start
    //clients will reset their positions in this case.
    game.player_client.send('s.r.' + String(game.gamecore.local_time).replace('.', '-'));
    game.player_host.send('s.r.' + String(game.gamecore.local_time).replace('.', '-'));

    //set this flag, so that the update loop can run it.
    game.active = true;

};

game_server.findGame = function (player) {

    this.log('[HALMA] Looking for a game. Current Games: ' + this.game_count);

    //so there are games active,
    //lets see if one needs another player
    if (this.game_count) {

        var joined_a_game = false;

        //Check the list of games for an open game
        for (var gameid in this.games) {
            //only care about our own properties.
            if (!this.games.hasOwnProperty(gameid)) continue;
            //get the game we are checking against
            var game_instance = this.games[gameid];

            //If the game is a player short
            if (game_instance.player_count < 2) {

                //someone wants us to join!
                joined_a_game = true;
                //increase the player count and store
                //the player as the client of this game
                game_instance.player_client = player;
                game_instance.gamecore.players.other.instance = player;
                game_instance.player_count++;

                //start running the game on the server,
                //which will tell them to respawn/start
                this.startGame(game_instance);

            }
        }

        //now if we didn't join a game,
        //we must create one
        if (!joined_a_game) {
            this.createGame(player);
        }
    } else {
        //no games? create one!
        this.createGame(player);
    }
};

