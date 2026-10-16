# Changelog

Each `## vX.Y.Z` section becomes the GitHub release notes and the "what's new" list in the in-app
update notice (the first few bullets). `scripts/release.sh` refuses to release a version without one.

## v1.0.0
- **The story is finished.** Act VIII: Dez finally places the carrier he couldn't find, and it's under the camp. Bunker Zero is sixty rungs below the forecourt at Last Chance, built by the woman who built every other bunker in the valley. Raise Mara after the Fortress's debrief to start it
- **The showroom.** Every founder's defences as they were first drawn: Tanner's tin-can tripwires, Ezra's cameras, Prudence's laser grid, Vesper's airlock (the code is the time on the clock over it), and two polite Doormen who walk you back to the ladder. At the end, a board with four units of power and a round door that wants two. Each display has a placard with the change orders the founder signed, which are the ways you got in
- **Who gets the well.** Keep the master key and Zero belongs to Last Chance, or break it and send the well up to a standpipe on the forecourt for anyone who walks up the highway. Either way the camp drinks every day afterwards, and Mara's last debrief ends the story. The valley stays open: keep playing as long as you like
- **The Cloud Cathedral is open.** Act VI: Orrin Sayle's fulfilment centre in the north basin, built like a cathedral, with a rose window that tells the time and a bell tower that launches delivery drones. Dropt's road leaves the highway east of Recovery Point 7
- **The swarm.** Drones circle the lot and tag anyone they see as a delivery address. The rest come, and enough of them together carry you back to the edge of the lot. Hide under the vans and the awnings, shoot them down, ground them at the tower, or carry Rider 9's open order and they'll let you be
- **Ride in as a return.** The returns kiosk takes an order number, and you ride the line in a tote over the aisle and into the heart of the building. Or go in through the dock, where robots shuffle the shelving cell by cell and stop for anything in their way
- **The Chip Fortress is open.** Act VII: Kit Szabo's black star fort under the southern range, inside a moat of coolant at minus forty. Lower the drawbridge, drain the moat, or swim it and come out too cold for the thermal cameras to see
- **Three units of power.** The Fortress's board runs the chillers, a laser grid, the lights and the vault door, and there isn't enough for all of them. Choose what to switch off
- **Two endings each.** Shut the Cathedral and let the night shift walk out, or hand it to them and get a delivery at camp every morning. Cook Kit's nine months of chips, or send the Fortress's power to the camps
- **New people.** Orrin and the four associates still on the shift that started on Pivot Day, led by Lo; Kit, waiting for the price to peak, and Marek's technicians on one unit of heat a day. Lo comes to the camp if she walks out
- **New people.** Agnes Price, the builder, at her drafting table by the well, and her two Doormen
- **More voices.** 218 new lines for Orrin, Lo, the associates, the drones, Kit, Marek, the technicians, Agnes and the Doormen, and Mara's three debriefs

## v0.9.0
- **The Singularity Dome is open.** Act V plays to the end: past the 5G tower, Ascend's drive carries on south to Hunter Vale's glass dome on the shelf under the striped range, with two cooling towers steaming beside it. At night it glows blue from across the valley. Mara debriefs you at the fire and names the founders who are left
- **It learns.** The founder twin that runs the Dome reads your record before you reach the fence and ships a fix for your favourite trick. Inside, every method you use gets patched: picks stop working, codes rotate, the Helpers get shielding, armour or thermal. Keep changing how you do it, or find the engineer who has to approve every fix
- **Ascend Helpers.** Polite humanoid robots walk the yard and the racks. They don't hurt anyone; if one catches you it walks you back to the gate and thanks you for your feedback. Shoot one or EMP it and it falls over and reboots later
- **The man at the gate.** Hunter Vale walked all the way there from the drive-in, and his own gate didn't recognise his voice. What he left in the visitor hut opens more than one door. The keynote reel from the Starlite and the EXIT pass from his jet both work on his gate
- **Pull the plug, or give it a job.** At the top of the dome, decide what happens to the twin. Switch it off and Dry Creek's old well comes back; give it a new job and a Helper brings water and a battery to the camp every morning
- **Two new people.** Gil, the last on-call engineer, who has approved every patch for three and a half years and will happily stop, and the hologram of Hunter giving the all-hands to two hundred empty chairs. Gil turns up in Dry Creek afterwards
- **More voices.** 123 new lines: the twin, Gil, the Helpers, ARIA at the gate, Hunter's last memo and Mara's debrief. Ezra's and Prudence's remarks over their speakers while you hang around outside are voiced for the first time too
- **Fixes:** the Act IV quest marker pointed at the 5G tower (the wrong Spire) instead of the Alignment Spire; the glows round lamps and beacons at Apex Vault, the Panopticon and the Spire (the Spire's safety-level ring, its tip, the Panopticon's lamp) were drawn far away from them; on Linux, quitting the desktop app no longer crashes it in the graphics driver (it left a large crash file every time)

## v0.8.1
- **Wolves move like wolves.** They walk, trot and gallop now instead of playing one walk at every speed, and their paws stay on the sand: before, their feet sank out of sight and slid along the ground. They step round when they turn, their tails are tucked when they're hit and stream out when they run, and the dead ones lie on the ground instead of half inside it. Coyotes too
- **Kade crews walk on real motion capture.** Contractors walk, run and crouch on recorded movement with their feet planted, turn their legs the way they're going, back up properly, and take small steps when they turn on the spot. Their bodies and guns move with their steps, and on patrol they carry the rifle low in one hand. Fixed a crew member who reached his post and kept walking on the spot
- **Dry Creek stands still properly.** Nia, Doc, Inez, Ezra, Prudence and Benny used a stock idle that slowly turned them sideways and, at one point, gave you their back. They now stand facing you, arms at their sides
- **Rattlesnakes.** A rearing snake's body no longer drops into the ground behind its head, and a coiled one is a curl instead of a lump. Snakes and scorpions lie flat on slopes
- **Rock.** Cliffs show their layers up close instead of smooth streaks, and boulders have a dark weathered crust, cracks and lichen instead of pale blobs
- **Tents.** The camp's and Kade's outposts' tents are real ridge tents with guy lines and stakes
- **Smoother frame rate.** Fewer draw calls across the map (up to a fifth fewer in a fight)
- **Saves when you quit.** Closing the game keeps your last minute; before, only the once-a-minute autosave did

## v0.8.0
- **The Alignment Spire is open.** Act IV plays to the end: take the highway east until it climbs into the tablelands, and follow Careful Labs' guardrailed road up to Prudence Ashby's white tower above the Tube. The light at the top shows the Spire's safety level. Every slip raises it, and at level four the whole building pauses. Mara debriefs you at the fire and names the next door
- **Turrets with manners.** The Careful Sentinels apologise before they fire. Get out of sight before they finish and they log a near miss. Put your weapon away and they won't shoot at all, but they report you, and the level goes up
- **A door that knows what you did.** The Spire's front door asks about your own game: the ledger, how you got into Apex, Ezra's archive, Ada, what you've killed. It doesn't care whether you were good, only whether you tell the truth. Or jailbreak it, show it a dead red-teamer's badge, or blow it
- **Take the water, or let it run.** The plant on the top floor pulls 300 litres a day out of the air. Pull its core and carry it home with the Spire paused behind you (no running, no weapon, and the turrets stop apologising), or open the red valve and send the water down Benny's pipe to Dry Creek. The camp or the creek drinks from it every day afterwards
- **Three new people.** Prudence in person at her window, Benny at his plant, and Noor, the last red-teamer, asleep at her desk on the eval floor. Wake her and she'll help; get the top door open and she walks out, and turns up at Nia's counter in Dry Creek fixing radios
- **More voices.** 99 new lines for Prudence, Noor, Benny, the door, the sentinels, and Mara's debrief

## v0.7.0
- **The Panopticon is open.** Act III plays to the end: follow the valley north from the salt to Ezra Seymour's building, a ring of reviewers' desks built round the old Point Argus lighthouse. Its blue lamp turns once every forty seconds and calls Kade up the valley if it catches you in the open. Get through a face gate that only opens for staff, past four cameras on the tower that watch each other's junction boxes, and into the tower. Mara debriefs you at the fire and names the next door
- **Ezra in person.** He stands at his monitor wall in the tower and answers back. Take his archive of three years of every camp to Mara, wipe it, or broadcast it to every radio in the valley, and the debrief remembers which
- **Ada Ivers.** Doc's sister is at desk 7. She knows the camera order and the tower code, and if you talk to her she walks out while Ezra is busy with you. After that she's at Doc's desk in Dry Creek. Two more reviewers share the ring: one reports you, one doesn't
- **Your camp loop pays off.** If you looped the Glimpse camera by the camp road, the lamp still files you as an empty forecourt
- **More voices.** 66 new lines for Ezra, Ada and the reviewers
- **Phones: a cleaner HUD.** The thumb buttons sit in one corner, Use only appears when there's something to use, the torch moved to the top bar, the objective folds to two lines, and empty hotbar slots are hidden
- **Phones: install it, play offline.** Tapping Play on a phone offers to install the game. Android installs it in one tap; iPhone shows the three steps. Once installed it saves itself (about 55 MB, voices included) and plays with no connection
- **Phones: the installed app opens everywhere.** On Xiaomi phones (HyperOS/MIUI) and some others, the home-screen icon did nothing when tapped. The app now asks for full screen and landscape on your first tap instead of in its install settings. If you installed it before, remove it and install it again
- **A new website.** A gameplay video at the top, how a job goes, every place and bunker, and what's new, straight from this list

## v0.6.1
- **Everything you read, rewritten.** Every note, log, letter, poster, quest, journal entry, item and character bio got a pass so it reads like it was written by the person who wrote it: county forms read like forms, tired guards write in lowercase, the founders' group chat looks like a real group chat, and a man walking west writes like a man, not a novelist. Fewer punchlines, more detail
- **Documents look like documents.** Station logs, flight recorders, field books and letters keep their line breaks
- **More of the cast speaks.** 135 more voiced lines: Dez's rumours on the band, Mara's briefing for each character, what Dry Creek says when you come back, everyone's "where were you that afternoon", the camp's greetings, and Tanner's and Vesper's shouts over the speakers
- **Fixes:** the Tube's pod read a stage direction aloud in its own voice; the Longshot was described as south of camp (it's north); a medkit's venom effect was described wrong

## v0.6.0
- **Apex Vault is open.** Act II plays to the end: cross the salt flat in the far west to Vesper Kade's rocket hangar and get in through the hangar door, the airlock (her code is the launch clock), a vent on the hill, or past her intercom with the right words. Lasers, cameras, a Kade gatehouse, an ambush on the way out with her water, and a merch drone. Mara debriefs you at the fire and names the next door: the Panopticon
- **Five new favours, fifteen things to read.** Piece together the founders' leaked #LIFEBOAT group chat, dig up Pip's time capsule at the ruined Kade Kids Academy, deal with the Glimpse camera watching the camp (and the man behind it), find the song Sol's wife played on the last day, and help Doc look for his sister in the Everafter line. The journal has a new Papers tab
- **Three new places.** The Longshot, a Kade booster crashed in the north basin; Waitlist City, four thousand people still queued outside a bunker that never opened; Photon Park, a solar farm whose cleaning robots never stopped. Kade checkpoints on the highway, and more stashes to find
- **People keep hours.** Dry Creek and the camp follow daily routines (the diner stays open late, Doc makes night calls, Hollis keeps watch, Pip sleeps), react to how Act I ended and what you've done since, and Dez's rumours on the band mark places on your map
- **New gear.** The Hush .22, a suppressed pistol for quiet work; the molotov, with a throw arc to aim it; survey binoculars that tag contractors, cameras, tripwires and lasers; a plate carrier, bandages, a canteen and Founder Focus pills. Weapon mods at the fire (a 4× scope, a choke, a speedloader), 14 kinds of salvage and 13 new recipes
- **Inez's Till.** Dry Creek has a shop: barter on her slate, and her stock changes every day
- **Kade sends specialists.** Marksmen on overwatch towers (watch for the scope glint), armoured breachers who walk through your cover, grenadiers with smoke. Crews search where they lost you, find bodies, radio for help, rush you while you reload, keep out of fire, and sometimes surrender
- **A livelier desert.** Vultures circle kills and land to feed, coyotes slink past at night, and ravens, jackrabbits and lizards scatter at gunshots
- **A map worth opening.** A full-screen survey map with fog of war, quests you can track, and fast travel between camps you've found (it costs the time, food and water the walk would)
- **Bigger skies.** Cumulus clouds that catch the sunset, cloud shadows rolling over the flats, a better night sky and moonlight, canyon tablelands on the horizon, backlit grass, leaves in the wind, a mirage on the road on hot afternoons. ColdStorage, the jet, the drive-in and the Spire are lit at night, and the far city's windows come on floor by floor
- **Smoother in the desktop app.** The HUD no longer costs frame time in the Linux app (calm scenes went from about 45–50 to 56–60 fps on our test laptop), less work per frame, and faster loading
- **Also:** aim assist on controllers, hints that name your own key bindings, and fixes (the jet's and the drive-in's glows were drawn in the wrong place, the Compliance Sentry's laser was a metre long, crews that ran away kept their outpost "active")

## v0.5.7
- **People move like people.** Dry Creek's townsfolk and the camp's four no longer move in lockstep: everyone keeps their own tempo, drifts between several idles, chats with the others now and then, and turns to look at you one by one. Hollis and Dez stopped mirroring each other on their log
- **Hands that face the right way.** No more wrists wrung like candy wrappers, borrowed animations put hands where they belong, Ren and Pip finally have mugs to drink from and Doc carries his clipboard. Inez rings up the till now and then instead of all the time
- **Kade's crews hold their guns properly.** Hands stay on the grip and under the forend wherever they aim, and a squad standing around breathes and shifts its weight instead of freezing

## v0.5.6
- **Company at the fire.** Mara, Hollis, Pip and Dez sit round the camp's fire, and the title screen and character select now open on them at dusk. New runs start right there at the fire
- **Fights hit harder.** Kade's crews react to where you hit them, stumble and die on their feet, get pinned down by near misses, lay down covering fire and flank. Wolves warn you with a crouch and a growl, then leap. Getting hit knocks your view; near death your heartbeat takes over the screen
- **SPLICE: a hacking minigame.** Field terminals at every Kade outpost (switch off sentries, land drones, call in a resupply), plus new ways into Tanner's vault and ColdStorage's core. Craft trace spikes to buy time
- **Night stealth.** At night you're harder to see in the dark; firelight, floodlights and your torch give you away. The HUD tells you whether you're IN SHADOW or LIT
- **Three new side quests.** A courier who kept delivering after the end of the world (and a new place, The Last Mile), Dez tapping Kade's radio, and Wick's war on survey stakes
- **Storms you can watch coming.** A dust wall rolls in at ground level and swallows the ridges, with gusts, tumbleweeds and dry lightning. SeedBot got a taser and smokes when you shoot it
- **A world with more in it.** The gas station dressed on every side, guardrails and bullet-holed road signs, clumped grass and cracked desert pavement, the Spire's collapsed cell-tower compound (and the truthers it fell on), Kade's outposts in full corporate livery, a moon with a face, the Cut in banded sandstone
- **It sounds alive.** Combat music, gunshots that ring indoors and roll across the flats, ringing ears after a blast, birds by day and owls and coyotes at night, and Dry Creek's people talk to you as you pass (and complain about your gunfire)
- **Controllers and rebinding.** Play and navigate every menu with a gamepad; remap any key or button in Settings → Controls. Also new: field of view, invert look, head bob and an FPS counter
- **Faster.** Smoother in fights (roughly 42 → 46–50 fps on our test laptop), and the web version downloads less and starts sooner
- **Fixes.** Kade crews that lost you no longer stay in combat forever, a bad setting can't stop the game launching, the gold brochure at the jet can be picked up, one loot message per find, Tanner greets you once, and nobody sits inside their log

## v0.5.5
- **Kade's crews are real people now.** Hi-vis vests, hard hats with the KADE badge (the squad leader's is orange), respirators, the works. They still take cover, aim, reload and go down in a heap when you drop them
- **Dry Creek has faces.** Nia, Doc, Inez, Sol, Ren and Wick are fully modelled: Nia works her counter, Inez rings up the Till, Sol and Ren sit by the fire (Ren nursing a drink), and Wick dozes in the Cut. Walk up and they turn to look at you and talk with their hands
- **Rattlesnakes and scorpions** got the same treatment: a banded rattler that still coils, strikes and slithers, and a desert scorpion with its tail up, caught in your torch at night
- **Wolves die properly.** No more flailing legs: a shot wolf buckles, collapses onto its side and goes still. One shot mid-run skids before it drops

## v0.5.4
- **Real wolves.** The packs are now proper animals: a lean, scarred desert wolf with a real coat and a natural walk, in place of the old blocky one. They still stalk low, track you with their heads, snap when they bite, howl at night and fall onto their side when they die

## v0.5.3
- **Scavenging.** Survivors mark their stashes with a red rag on a stick: 18 of them are hidden around the map (ammo cans, footlockers, travellers' packs, Kade crates, roadside coolers), and they get topped up again after a while. Every wreck on the highway can be searched too. Ammo you find favours the guns you carry
- **Wolves respect walls.** Packs no longer walk through buildings in town, and Kade's contractors don't either
- **Bullets leave marks.** Shots chip stone, punch bright holes in steel, splinter wood and kick divots into the sand, and the marks stay
- **Brass.** The lever rifle flips out its casings, the shotgun throws red hulls on every pump, and the revolver dumps its empties when you reload. They bounce and lie where they land

## v0.5.2
- **Real voices.** Every spoken line in the game is now voiced: Mara on the camp radio, Nia and the rest of Dry Creek in person, Tanner through his megaphone, Hunter Vale over the drive-in speakers, the AIs, and every Kade contractor (each one keeps their own voice, and you hear where they're shouting from). Music dips while people talk. Settings → Voices turns it off if you'd rather read
- **No more mumbling.** The campfire and the camp radio no longer fake a conversation. The fire sounds like people sitting round it (cups, creaking crates, a log knocked in), and the radio drifts between static, a Morse beacon and a scratchy song
- **Settings menu fixed.** The controls no longer spill past the edge of the panel

## v0.5.1
- **No more robot voices.** Kade's contractors speak in subtitles now, over the click and hiss of their radios, and go down with a thud instead of a synthesised groan. Tanner's text-to-speech megaphone is off by default (Settings can turn it back on)
- **Intel looks like intel.** The pink light pillars are gone: the note is pinned under a rock on the pump island, the blueprint is weighed down on a crate, Greg's voicemail is on a roadside call box with its light blinking, and so on. A small glint still catches your eye
- **Two hands on the revolver.** The support hand now cups the gun hand properly instead of crumpling beside it
- **No more car parts in the sky.** A piece of every wreck had been floating above it since v0.4 (one 107 m up). Fixed everywhere
- **Billboards stand on the ground.** On slopes, both posts now reach the dirt

## v0.5.0
- **You can fight back now.** A crowbar, Hollis's six-shooter, a pump shotgun and a lever-action rifle, each with its own model, sound and handling. Aim down the sights (right mouse), feel the kick, reload a round at a time, swap with Q or the wheel. Rounds come off the dead, or the camp reloads brass from scrap
- **The road has teeth.** Kade Holdings' Recovery crews hold four outposts and walk the highway. They spot you from a distance (less at night, in a dust storm or when you crouch), shout to each other, take cover, peek and fire, flank when you go to ground, and lob "compliance charges" if you dig in. Lose a few and the rest run
- **Wolves hunt.** The pack picks up your scent, stalks in low, circles you and sends one wolf at a time in for a bite. Your torch makes them hesitate and they won't follow you to a fire or into town. Kill two and the rest break
- **Machines at the outposts.** Compliance Sentries say please before they open fire (shoot the eye, EMP them, or sneak round the back and pull the breaker), Hornet drones circle with searchlights, and the property line is mined: listen for the click
- **Small dangers.** Rattlesnakes rattle before they strike and scorpions come out at night. Their venom burns until you use a snakebite kit
- **Other ways through.** Come up behind someone who hasn't seen you and a crowbar ends it quietly. Noise travels: a gunshot brings every crew in earshot, a quiet takedown brings nobody
- **Dying costs something.** You wake at the fire hours later, and everything but your weapons stays in a pack where you fell, marked on the map. Die again before you get back to it and it's gone
- **New Firearms skill** with steadier aim, faster reloads, headshot damage and two branches (Quickdraw or Marksman, Deadeye or Brawler). Difficulty is in Settings: Story, Wasteland or Hard Water
- **Desktop app:** mouse clicks and the wheel now reach the game while the mouse is captured, so shooting works in the Linux app

## v0.4.0
- **Everything holds up close now.** The wrecks along the highway, in Dry Creek, at the data centre and at the drive-in are real cars: rounded bodies, dusty glass with wiper arcs and cracked windshields, chrome bumpers, quad headlights, tyres and hubcaps, seats and dashboards inside, engines under open hoods. Sedans, coupes, wagons, pickups, vans and convertibles, some burnt, some on their roof, some on flat tyres, all sun-bleached and rusting up from the bottom
- **A living desert.** Gnarled dead cottonwoods and shaggy Joshua trees, with creosote, sagebrush, prickly pear, barrel cactus, yucca, ocotillo and mesquite between them. Each grows where it should: cacti on the stony slopes, green mesquite and wildflowers down in the wash
- **Wildlife.** Vultures circle overhead, ravens sit on the power poles and caw at you, jackrabbits bolt when you get close, lizards dart between the rocks, butterflies drift over the wash and flies buzz around the wrecks. A wolf pack roams at a distance, stops to watch you, runs if you approach and howls at night. None of them will hurt you
- **Better ground.** Finer grass with seed heads, pebbles and gravel underfoot, and rocks that look like broken stone, with cracks, desert varnish and lichen
- **Faster indoors.** Inside the Garage, The Cut, the Tube and the data centre's server hall, the game stops drawing the world outside whenever you can't see it, so they run noticeably smoother. In the desktop app, about 50 fps went to about 63 inside the Garage

## v0.3.1
- **No more freezing when you start moving (desktop app).** The game used to prepare each piece of the world's graphics the first time it came into view, and the desktop app stops while it does. Pressing W, sprinting, turning around or switching on the torch could freeze it for a second or more, so walking felt stuck. All of that now happens on the loading screen, and the loading bar keeps moving while it does
- **The run starts cleanly.** Your hands, the torch and everything you can hold are ready before the fade lifts, so the first sprint no longer hitches

## v0.3.0
- **Smooth again, and lighter than ever.** v0.2.0 lit every pixel with sixteen lights and drew Dry Creek from across the map. Lights are now shared from a small pool, far places swap to cheap stand-ins, and shadows draw in a fraction of the passes. About 40% fewer draw calls than v0.1.9, with far more world
- **Four new places to break into.** The Exit Strategy, a founder's private jet that tried to leave early. Starlite Drive-In, where you can restart the projector and watch the last keynote at night. ColdStorage, a data centre with an AI that still answers. The Tube, a hyperloop test track you can power up and ride to the broken end
- **Dry Creek and The Cut, rebuilt.** Real buildings with dressed interiors (the diner has booths and a menu board), people who breathe and turn to look at you, and a cave that is an actual cave
- **A new look.** Clearer air and real skies, a Milky Way at night, rock that shows its layers, dust that settles on everything after a storm, a time-of-day colour grade, and a drone that scans with a soft beam
- **Places sound like places.** Cave drips, server hum, a radio murmuring to itself, voices round the fire, footsteps that know sand from metal, and an echo when you step indoors
- **Act I has a real ending.** Find out who Tanner actually pays, why Dry Creek went dry, and whose name is on the last page of the Seed Manifest. Then Vesper Kade cuts into the debrief with an offer, and you decide what the camp does with the ledger
- **A quest log.** The journal (J) tracks the main story and ten favours: one for each person in Dry Creek and the Cut, one for each new place on the map, and Pip's water ledger at the camp. Track one and the corner of the screen follows it
- **People remember.** Every favour ends on a choice, and the town keeps score: a free plate at the diner, house calls, cheaper water, a better pick recipe, and who says yes when you ask them to walk west with you
- **Two new people can take the radio.** Juno Reyes, a county ranger who walks far on very little, and Theo Vance, a founder who gave his bunker seat back. Character select now shows all six at once
- **Skill trees.** Skills get their own screen (K). Every skill branches at rank 2 (a focus) and again at rank 4 (a capstone, such as a bump key that opens any three-pin lock, or an exit plan that makes getting tased free)

## v0.2.0
- **Dry Creek.** West of the highway: a diner, a clinic, a store, and a motel, with people who are not the job. Nia, Doc, Inez, Sol, and Ren each ask for a different skill
- **The closet is a stair.** In the Till, lockpicking 3, a charge, or enough conversation that Inez admits to the key. The page at the top cannot be read from the ground floor
- **The wash, north of the spire.** Posts lead up the ridge to a cave, The Cut. Wick lives in it. A pocket in the rock stays shut until you spend a charge
- **A focus at rank 2.** Six skills, and once a skill is rank 2 the point can shape it instead of raising it: shorter locks, a pick that sometimes holds, a simpler bypass, a quieter step, a charge that does not wake the street
- **The radio has a reason now.** Day 1,284. The camps are thirsty. The job is the cistern and the Seed Manifest. Four people can take it. Hunger, thirst, and the pack are part of the walk. At the end of the debrief, Vesper Kade names Apex Vault. That door is not in this release

## v0.1.9
- **Real music.** A generative soundtrack in the spirit of a spaghetti western: plucked guitar with echo, warm pads, bass and a whistled main theme on the title screen. Out in the wasteland it plays in pieces of a minute or two with quiet stretches between them, so it never wears thin
- **Music follows the action:** a tense pulse and heartbeat rise as SeedBot gets suspicious, drums kick in when the alarm goes off, plus stingers for busting the vault and getting caught. The Music slider in Settings now does something
- **The wind no longer drones on.** A soft breeze with gusts that swell and pass, quiet lulls in between, and wildlife: cicadas on hot afternoons, crickets and distant coyotes at night. The desert goes muffled when you're inside the bunker. Dust storms still roar
- **Play on your phone.** Open the site on a phone and tap Play: the game goes full screen in landscape with touch controls. Drag on the left to walk (push past the ring to sprint), drag on the right to look, plus buttons for jump, crouch, use, flashlight, kit, map and pause. Prompts and hotbar items are tappable too
- Lockpicking, the oscilloscope and keypads all work by touch (press and hold a pin to lift it)
- Phones start on Low graphics and render below native resolution to keep the frame rate up. On iPhone, use Share → Add to Home Screen for full screen
- Menus, the kit, the map and the minigames fit short landscape screens; panels have a close (✕) button

## v0.1.8
- **Fixed: invisible walls in the open desert.** Walking up even a gentle dune could slow you to a dead stop with nothing in the way (worse at high frame rates). You now walk and sprint freely over the sand, and only real obstacles stop you
- **Fixed: jumping did nothing at high frame rates** (100+ fps, e.g. the browser build on a 144 Hz screen)

## v0.1.7
- **Dust storms** roll in and out: brown-out visibility, blowing sand, howling wind, dry lightning with distant thunder, and SeedBot's optics are half-blind in them (a stealth opportunity)
- **Sky and light**: eye adaptation, deeper day sky, longer twilight afterglow, a milky way and a cratered moon; dust devils on calm afternoons; a dead megacity skyline on the horizon; pebbles and grit underfoot
- **The Garage, rebuilt in detail**: ribbed roll-up door, neon spilling onto the door and yard, razor wire, yard clutter, a lived-in workshop (ceiling joists, pegboard, shelving, posters), a proper vault with cash and gold, red alarm beacons that sweep the rooms
- **Effects**: a new EMP blast (arcs, shock ring, sparks), sharper lasers with dust glints, SeedBot nav lights, sparks and smoke when it browns out or crashes
- **Performance**: far fewer draw calls (batched materials, the hands, SeedBot and the campfire merged, instanced tumbleweeds, cheaper HUD and minimap updates)
- Fixed: a stripe artifact across concrete floors and ceilings

## v0.1.6
- **Fixed: the 3D view could fill only part of the window** if the window was resized while the game was loading (common with tiling window managers): the game now re-fits whenever the window size changes

## v0.1.5
- **Fixed: the Linux desktop app froze the moment you entered the game.** Capturing the mouse stopped the window from showing new frames (the game kept running behind a frozen picture). The app now captures the mouse itself, so the picture stays live
- **Fixed: mouse look spun wildly** in the desktop app (it was reading screen positions as movement)
- Escape or switching away from the window releases the mouse and pauses

## v0.1.4
- **Fixed: mouse look was dead in the Linux desktop app** (XWayland on NVIDIA laptops), so the game seemed frozen once you were in: the app now reads raw mouse motion itself
- If the game can't capture the mouse it now says "Click to resume" instead of silently ignoring the mouse

## v0.1.3
- **Linux desktop app is 3–4× faster in menus**: title screen 13 → 50+ fps, menus 14 → 45 fps on an RTX 4050 laptop (blur and glow effects that WebKitGTK redraws on the CPU every frame are swapped for flat equivalents there; browser and Windows keep the full look)

## v0.1.2
- **Fixed: menu clicks did nothing in the Linux desktop app** on NVIDIA laptops under Wayland (Hyprland/Omarchy), so you couldn't get past the title screen
- **Fixed: the app launcher showed a placeholder icon** for tarball installs (re-run `install.sh` to refresh the menu entry)

## v0.1.1
- **Natural hands**: rebuilt anatomy and poses; empty hands rest out of view and come up when you use them
- **Real physics**: true gravity, momentum and air drag, fall damage, hard landings, stamina and breathing
- **In-app updates**: the desktop app tells you when a new version is out and installs it for you
- **Physical EMP canister** that bounces and rolls; SeedBot crashes out of the sky when it's hit
- Footsteps in sync with your stride, dust kicked up by landings and sprints, and a fix for physics running too fast on high-refresh screens

## v0.1.0
- First public release: The Garage (Tier 1), Infiltrator and Engineer, lockpicking, circuit bypass and keypad minigames, SeedBot, day/night cycle.
