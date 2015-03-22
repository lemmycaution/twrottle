Rules = new Mongo.Collection("rules");

if (Meteor.isClient) {
  
  var ruleset = [
    {
      text: "$follow people who says any of $term",
      inputs: {
        $follow: '<input type="hidden" name="action" value="follow" /><strong>Follow</strong>',
        $term: '<input type="text" name="term" placeholder="comma separated terms" />'
      }
    },
    {
      text: "$favorite tweets contain any of $term",
      inputs: {
        $favorite: '<input type="hidden" name="action" value="favorite" /><strong>Favorite</strong>',
        $term: '<input type="text" name="term" placeholder="comma separated terms" />'
      }
    },
    {
      text: "$retweet tweets contain any of $term",
      inputs: {
        $retweet: '<input type="hidden" name="action" value="retweet" /><strong>Retweet</strong>',
        $term: '<input type="text" name="term" placeholder="comma separated terms" />'
      }
    },
    {
      text: "$reply with $tweet to tweets contain any of $term",
      inputs: {
        $reply: '<input type="hidden" name="action" value="reply" /><strong>Reply</strong>',
        $tweet: '<input type="text" name="tweet" placeholder="tweet" />',
        $term: '<input type="text" name="term" placeholder="comma separated terms" />'
      }
    },
    // {
    //   text: "$directmessage with $tweet who follows me",
    //   inputs: {
    //     $directmessage: '<input type="text" name="action" value="directmessage" readonly />',
    //     $tweet: '<input type="text" name="tweet" placeholder="tweet" />'
    //   }
    // }
  ];
  var rulesHandler = Meteor.subscribe("rules");
  
  Template.ruleList.helpers({
    rulesReady: function(){
      return rulesHandler.ready();
    },
    rules: function() {
      return Rules.find();
    }
  });

  Template.ruleForm.helpers({
    ruleset: function() {
      return ruleset;
    },
    parseRule: function(text, inputs){
      var 
      r = new RegExp("(\\$[a-z]*)","g"),
      m = text.match(r);
      m.forEach(function(i){
        text = text.replace(i, inputs[i]);
      })
      return text;
    }
  });
  
  Template.ruleForm.events({
    'submit': function (e, t) {
      e.preventDefault();
      // if(e.target.term)
      //   e.target.term.value = e.target.term.value.replace(/\s,\s|\s,|,\s/,",");
      var data = {
        // userId: Meteor.user()._id,
        text: e.target.text.value,
      };
      ['action','tweet','term'].forEach(function(input) {
        if (e.target[input]) {
          data.text = data.text.replace("$" + e.target[input].value, "$" + input);
          data[input] = e.target[input].value;
        }
      })
      // Rules.insert(data);
      Meteor.call('addRule', data);
      e.target.reset();
    }
  });
  
  Template.ruleItem.helpers({
    parseRule: function(text){
      var 
      r = new RegExp("(\\$[a-z]*)","g"),
      m = text.match(r);
      m.forEach((function(i){
        text = text.replace(i, this[i.replace("$","")]);
      }).bind(this))
      return text;
    }
  });
  
  Template.ruleItem.events({
    'click .remove': function (e, t) {
      e.preventDefault();
      // Rules.remove(this._id);
      Meteor.call('removeRule', this._id);
    }
  });
}

if (Meteor.isServer) {

  Fiber = Npm.require('fibers');

  T = new TwitMaker({
    consumer_key:         Meteor.settings.CONSUMER_KEY,
    consumer_secret:      Meteor.settings.CONSUMER_SECRET,
    access_token:         Meteor.settings.BOT_ACCESS_TOKEN,
    access_token_secret:  Meteor.settings.BOT_SECRET
  });

  stream = null;

  Meteor.publish("rules", function () {
    return Rules.find({ userId: this.userId });
  });

  Meteor.methods({
    addRule: function(data) {
      var userId = Meteor.userId();
      if (! userId)
        throw new Meteor.Error("not-authorized");
      if(data.term)
        data.term = data.term.replace(/\s,\s|\s,|,\s/,",");
      data.userId = userId;
      console.log("inserted",Rules.insert(data));
      restartStream();
    },
    removeRule: function(id) {
      var userId = Meteor.userId();
      if (! userId)
        throw new Meteor.Error("not-authorized");
      Rules.remove({_id: id, userId: userId});
      restartStream();      
    }
  })

  restartStream = function() {
    if(stream)
      stream.stop();
    
    var
    termRules = Rules.find({term: {$ne: null}}),
    track = termRules.map(function(r){return r.term}).join(",");
    
    stream = T.stream('statuses/filter', { track: track });

    stream.on('tweet', function (tweet) {

     Fiber(function() { 
       var regexp = tweet.text.replace(" ", "|");
       
       console.log(regexp);
       
       Rules
       .find({term: {$regex: regexp}})
       .forEach(function (rule) {
         
         var user = Meteor.users.findOne(rule.userId);

         T.setAuth({
           access_token: user.services.twitter.accessToken,
           access_token_secret: user.services.twitter.accessTokenSecret
         })
         
         console.log(rule.action)
         
         switch(rule.action) {
         case "follow":
           T.post('friendships/create', { id: tweet.user.id_str }, function (err, data, response) {
             console.log("err",err);
           })
           break;
         case "favorite":
           T.post('favorites/create', { id: tweet.id_str }, function (err, data, response) {
             console.log("err",err);
           })
           break;
         case "retweet":
           T.post('statuses/retweet/:id', { id: tweet.id_str }, function (err, data, response) {
             console.log("err",err);
           })
           break;
         case "reply":
           T.post('statuses/update', { status: "@" + tweet.user.screen_name + " " + rule.tweet }, function(err, data, response) {
             console.log("err",err);
           })
           break;
         }
       })
       
     }).run();

    });
  }

  Meteor.startup(restartStream);

}
