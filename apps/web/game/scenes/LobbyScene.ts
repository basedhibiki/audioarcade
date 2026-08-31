import Phaser from "phaser";

export default class LobbyScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  private wasd!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };

  private interactKey!: Phaser.Input.Keyboard.Key;

  private interactPrompt!: Phaser.GameObjects.Text;

  private sampler!: Phaser.GameObjects.Rectangle;

  private menuOpen = false;

  constructor() {
    super("LobbyScene");
  }

  create() {
    this.cameras.main.setBackgroundColor("#111111");

    //
    // ROOM
    //

    this.add.rectangle(240, 160, 460, 300, 0x1a1a1a)
      .setStrokeStyle(4, 0xffd400);

    this.add.text(
      16,
      14,
      "AUDIO ARCADE",
      {
        color: "#ffd400",
        fontFamily: "monospace",
        fontSize: "18px"
      }
    );

    //
    // SP404
    //

    this.sampler = this.add.rectangle(
      240,
      70,
      90,
      50,
      0x444444
    );

    this.add.text(
      210,
      62,
      "SP-404",
      {
        color: "#ffffff",
        fontFamily: "monospace",
        fontSize: "12px"
      }
    );

    //
    // PLAYER
    //

    this.player = this.add.rectangle(
      240,
      250,
      18,
      26,
      0xffd400
    );

    //
    // INTERACT PROMPT
    //

    this.interactPrompt = this.add.text(
      240,
      295,
      "PRESS ENTER",
      {
        color: "#000000",
        backgroundColor: "#ffd400",
        fontFamily: "monospace",
        fontSize: "14px",
        padding: {
          x: 10,
          y: 6,
        },
      }
    );

    this.interactPrompt
      .setOrigin(0.5)
      .setVisible(false);

    //
    // INPUT
    //

    if (!this.input.keyboard) {
      return;
    }

    this.cursors =
      this.input.keyboard.createCursorKeys();

    this.wasd = {
      W: this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.W
      ),
      A: this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.A
      ),
      S: this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.S
      ),
      D: this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.D
      ),
    };

    this.interactKey =
      this.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.ENTER
      );
  }

  update() {
    if (this.menuOpen) {
      return;
    }

    const speed = 2.5;

    let dx = 0;
    let dy = 0;

    //
    // MOVEMENT
    //

    if (
      this.cursors.left.isDown ||
      this.wasd.A.isDown
    ) {
      dx = -speed;
    }

    if (
      this.cursors.right.isDown ||
      this.wasd.D.isDown
    ) {
      dx = speed;
    }

    if (
      this.cursors.up.isDown ||
      this.wasd.W.isDown
    ) {
      dy = -speed;
    }

    if (
      this.cursors.down.isDown ||
      this.wasd.S.isDown
    ) {
      dy = speed;
    }

    this.player.x += dx;
    this.player.y += dy;

    //
    // KEEP PLAYER INSIDE ROOM
    //

    this.player.x = Phaser.Math.Clamp(
      this.player.x,
      20,
      460
    );

    this.player.y = Phaser.Math.Clamp(
      this.player.y,
      40,
      300
    );

    //
    // INTERACTION DISTANCE
    //

    const distance = Phaser.Math.Distance.Between(
      this.player.x,
      this.player.y,
      this.sampler.x,
      this.sampler.y
    );

    const nearSampler = distance < 65;

    this.interactPrompt.setVisible(
      nearSampler
    );

    //
    // OPEN MENU
    //

    if (
      nearSampler &&
      Phaser.Input.Keyboard.JustDown(
        this.interactKey
      )
    ) {
      this.menuOpen = true;

      this.game.events.emit(
        "open-aux-menu",
        {
          close: () => {
            this.menuOpen = false;
          },
        }
      );
    }
  }
}